// Transaction builder used only by the existing owner reconciler and its disposable proof.
import { readdirSync, readFileSync, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function transitionScope(owner,schema,archive) {
  const definitions = {
    dsh: { database:"bthwani_dsh_dev", owner:"bthwani_dsh_owner", runtime:"bthwani_dsh_runtime", schema:/^dsh_test_[a-z0-9_]{1,50}$/ },
    identity: { database:"bthwani_identity_dev", owner:"bthwani_identity_owner", runtime:"bthwani_identity_runtime", schema:/^identity_test_[a-z0-9_]{1,49}$/ },
    wlt: { database:"bthwani_wlt_test", owner:"bthwani_wlt_owner", runtime:"bthwani_wlt_reader", schema:/^wlt$/ },
  };
  const d=definitions[owner];
  if(!d || !d.schema.test(schema) || !new RegExp("^bthwani_recovery_"+owner+"_[a-f0-9]{12}$").test(archive))
    throw new Error("Invalid owner baseline transition scope");
  return {...d,schema,archive};
}

function baselineSources(owner) {
  return ["schema",...(owner==="wlt"?["sandbox"]:[])].flatMap(dir=>{
    const folder=resolve(root,"services",owner,"database",dir);
    const names=readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,"en"));
    if(!names.length || names.length>64)throw new Error("Invalid baseline inventory");
    return names.map(entry=>{
      const file=resolve(folder,entry.name), info=lstatSync(file);
      if(!/^[0-9]{2}_[a-z0-9_]+\.sql$/.test(entry.name)||!entry.isFile()||!info.isFile()||info.isSymbolicLink()||info.size>512*1024)
        throw new Error("Unexpected baseline entry");
      return readFileSync(file,"utf8");
    });
  });
}

export function buildOwnerBaselineTransition(owner,schema,archive,sources) {
  const d=transitionScope(owner,schema,archive);
  sources??=baselineSources(owner);
  if(!Array.isArray(sources)||!sources.length||sources.some(s=>typeof s!=="string"||!s.trim()||s.includes("\0")||(owner!=="wlt"&&!s.includes("__SCHEMA__"))))
    throw new Error("Invalid baseline source");
  const baseline=sources.map(s=>{
    const sql=owner==="wlt"?s:s.replaceAll("__SCHEMA__",schema);
    if(sql.includes("$bthwani_baseline$")||sql.includes("$bthwani_bootstrap$"))throw new Error("Reserved bootstrap delimiter");
    return "  EXECUTE $bthwani_baseline$"+sql+"$bthwani_baseline$;";
  }).join("\n");
  const roles=owner==="wlt"?[d.runtime,"bthwani_wlt_sandbox"]:[d.runtime];
  const roleList=roles.map(r=>"'"+r+"'").join(",");
  const roleNames=roles.join(",");
  const archivedTableException=owner==="identity"?"t='operator_merchant_scope_cutover_audit'":"false";
  const ordering=owner==="wlt"?"CASE WHEN t='customer_funding_journal' THEN ' ORDER BY reverses_funding_id IS NOT NULL, posted_at, funding_id' ELSE '' END":"''";
  return [
"BEGIN;",
"SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'; SET LOCAL search_path=pg_catalog; SET LOCAL timezone='UTC'; SET LOCAL client_min_messages=warning;",
`DO $bthwani_scope$
BEGIN
  IF current_database()<> '${d.database}' OR
    NOT EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)='${d.owner}') OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${d.owner}' AND NOT(rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR
    NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${d.runtime}' AND rolcanlogin AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) OR
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN(SELECT oid FROM pg_roles WHERE rolname IN('${d.owner}',${roleList}))) OR
    EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()) OR
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='${archive}') OR
    NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='${schema}' AND pg_get_userbyid(nspowner)='${d.owner}') OR
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN('information_schema','public','${schema}') AND nspname !~ '^bthwani_recovery_${owner}_[a-f0-9]{12}$') OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${schema}' AND (pg_get_userbyid(c.relowner)<>'${d.owner}' OR c.relkind IN('p','f','m'))) OR
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='${schema}' AND pg_get_userbyid(p.proowner)<>'${d.owner}') OR
    has_database_privilege('${d.runtime}',current_database(),'CREATE,TEMP') OR
    NOT has_schema_privilege('${d.runtime}','${schema}','USAGE') OR
    has_schema_privilege('${d.runtime}','${schema}','CREATE') ${owner==="wlt"?"OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bthwani_wlt_sandbox' AND NOT(rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))":""}
  THEN RAISE EXCEPTION 'owner baseline scope or exclusive writer not proven'; END IF;
END $bthwani_scope$;`,
`SET LOCAL ROLE ${d.owner};`,
`DO $bthwani_lock$ DECLARE t record; BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='${schema}' AND c.relkind='r' ORDER BY 1 LOOP
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE','${schema}',t.relname);
  END LOOP;
END $bthwani_lock$;`,
`ALTER SCHEMA ${schema} RENAME TO ${archive};`,
"DO $bthwani_bootstrap$ BEGIN\n"+baseline+"\nEND $bthwani_bootstrap$;",
owner==="dsh"?"DELETE FROM "+schema+".public_revision WHERE singleton AND revision=0;":"",
`DO $bthwani_copy$
DECLARE
  pending text[]; copied text[]:=ARRAY[]::text[]; t text; progress boolean;
  source_oid oid; target_oid oid; cols text; extras text[];
  bad boolean; n bigint; seq record; v bigint; called boolean; g record;
BEGIN
  SELECT array_agg(c.relname::text ORDER BY c.relname) INTO pending
    FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
    WHERE ns.nspname='${archive}' AND c.relkind='r';
  IF coalesce(cardinality(pending),0)=0 OR cardinality(pending)>100 THEN RAISE EXCEPTION 'owner table inventory invalid'; END IF;
  FOR t IN SELECT c.relname::text FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='${schema}' AND c.relkind='r' LOOP
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)','${schema}',t) INTO bad;
    IF bad THEN RAISE EXCEPTION 'fresh baseline contains unexpected rows'; END IF;
  END LOOP;
  WHILE cardinality(pending)>0 LOOP
    progress:=false;
    FOREACH t IN ARRAY pending LOOP
      source_oid:=to_regclass(format('%I.%I','${archive}',t));
      target_oid:=to_regclass(format('%I.%I','${schema}',t));
      IF target_oid IS NULL THEN
        IF NOT (${archivedTableException}) THEN RAISE EXCEPTION 'retained relation missing from baseline: %',t; END IF;
        EXECUTE format('SELECT count(*) FROM %I.%I','${archive}',t) INTO n;
        IF n<>0 THEN RAISE EXCEPTION 'historical audit has retained data'; END IF;
        pending:=array_remove(pending,t); progress:=true; CONTINUE;
      END IF;
      IF EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace ns ON ns.oid=r.relnamespace WHERE c.conrelid=target_oid AND c.contype='f' AND (ns.nspname<>'${schema}' OR (r.relname<>t AND NOT(r.relname::text=ANY(copied)) AND r.relname::text=ANY(pending)))) THEN CONTINUE; END IF;
      IF EXISTS(SELECT 1 FROM pg_attribute a LEFT JOIN pg_attribute b ON b.attrelid=target_oid AND b.attname=a.attname AND b.attnum>0 AND NOT b.attisdropped WHERE a.attrelid=source_oid AND a.attnum>0 AND NOT a.attisdropped AND (b.attname IS NULL OR a.atttypid<>b.atttypid OR a.atttypmod<>b.atttypmod OR a.attcollation<>b.attcollation OR a.attgenerated<>b.attgenerated OR a.attidentity<>b.attidentity)) THEN RAISE EXCEPTION 'incompatible retained column in %',t; END IF;
      SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO cols FROM pg_attribute WHERE attrelid=source_oid AND attnum>0 AND NOT attisdropped AND attgenerated='';
      IF cols IS NULL THEN RAISE EXCEPTION 'no transferable owner columns'; END IF;
      EXECUTE format('INSERT INTO %I.%I (%s) OVERRIDING SYSTEM VALUE SELECT %s FROM %I.%I%s','${schema}',t,cols,cols,'${archive}',t,${ordering});
      copied:=array_append(copied,t); pending:=array_remove(pending,t); progress:=true;
    END LOOP;
    IF NOT progress THEN RAISE EXCEPTION 'unresolved foreign key dependency or external reference'; END IF;
  END LOOP;
  -- Compare full retained row multisets after all INSERT triggers execute.
  FOREACH t IN ARRAY copied LOOP
    source_oid:=to_regclass(format('%I.%I','${archive}',t));
    target_oid:=to_regclass(format('%I.%I','${schema}',t));
    SELECT coalesce(array_agg(b.attname::text),ARRAY[]::text[]) INTO extras FROM pg_attribute b WHERE b.attrelid=target_oid AND b.attnum>0 AND NOT b.attisdropped AND NOT EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=source_oid AND a.attnum>0 AND NOT a.attisdropped AND a.attname=b.attname);
    EXECUTE format('SELECT EXISTS((SELECT to_jsonb(x) FROM %I.%I x EXCEPT ALL SELECT to_jsonb(y)-$1 FROM %I.%I y) UNION ALL (SELECT to_jsonb(y)-$1 FROM %I.%I y EXCEPT ALL SELECT to_jsonb(x) FROM %I.%I x))','${archive}',t,'${schema}',t,'${schema}',t,'${archive}',t) INTO bad USING extras;
    IF bad THEN RAISE EXCEPTION 'retained row parity failed in %',t; END IF;
  END LOOP;
  FOR seq IN SELECT c.relname, s.seqtypid,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid WHERE ns.nspname='${archive}' LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_sequence s WHERE s.seqrelid=to_regclass(format('%I.%I','${schema}',seq.relname)) AND (s.seqtypid,s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle)=(seq.seqtypid,seq.seqstart,seq.seqincrement,seq.seqmax,seq.seqmin,seq.seqcache,seq.seqcycle)) THEN RAISE EXCEPTION 'incompatible retained sequence'; END IF;
    EXECUTE format('SELECT last_value,is_called FROM %I.%I','${archive}',seq.relname) INTO v,called;
    PERFORM setval(to_regclass(format('%I.%I','${schema}',seq.relname)),v,called);
  END LOOP;
  ${owner==="wlt"?`IF EXISTS(SELECT 1 FROM ${schema}.customer_funding_journal WHERE provider_id NOT IN('sandbox','sandbox-reversal')) OR
    EXISTS((SELECT * FROM ${archive}.customer_funding_entries EXCEPT ALL SELECT * FROM ${schema}.customer_funding_entries) UNION ALL (SELECT * FROM ${schema}.customer_funding_entries EXCEPT ALL SELECT * FROM ${archive}.customer_funding_entries)) OR
    EXISTS((SELECT * FROM ${archive}.customer_wallet_balances EXCEPT ALL SELECT * FROM ${schema}.customer_wallet_balances) UNION ALL (SELECT * FROM ${schema}.customer_wallet_balances EXCEPT ALL SELECT * FROM ${archive}.customer_wallet_balances)) OR
    EXISTS(SELECT funding_id FROM ${schema}.customer_funding_entries GROUP BY funding_id HAVING count(*)<>2 OR sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END)<>0) THEN RAISE EXCEPTION 'WLT retained ledger or balance parity failed'; END IF;`:""}
  ${owner!=="wlt"?`-- Preserve previous table/column/sequence grants rather than widening Identity.
  EXECUTE 'GRANT USAGE ON SCHEMA ${schema} TO ${d.runtime}';
  FOR g IN SELECT c.relname,c.relkind,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE ns.nspname='${archive}' AND c.relkind IN('r','v','S') AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='${d.runtime}') LOOP
    IF to_regclass(format('%I.%I','${schema}',g.relname)) IS NULL THEN RAISE EXCEPTION 'granted retained relation missing'; END IF;
    IF g.is_grantable OR g.privilege_type NOT IN('SELECT','INSERT','UPDATE','DELETE','USAGE') THEN RAISE EXCEPTION 'unexpected retained grant'; END IF;
    EXECUTE format('GRANT %s ON %s %I.%I TO %I',g.privilege_type,CASE WHEN g.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,'${schema}',g.relname,'${d.runtime}');
  END LOOP;
  FOR g IN SELECT c.relname,b.attname,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace JOIN pg_attribute b ON b.attrelid=c.oid CROSS JOIN LATERAL aclexplode(b.attacl) a WHERE ns.nspname='${archive}' AND b.attnum>0 AND NOT b.attisdropped AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='${d.runtime}') LOOP
    IF g.is_grantable OR g.privilege_type NOT IN('SELECT','INSERT','UPDATE') THEN RAISE EXCEPTION 'unexpected retained column grant'; END IF;
    EXECUTE format('GRANT %s (%I) ON TABLE %I.%I TO %I',g.privilege_type,g.attname,'${schema}',g.relname,'${d.runtime}');
  END LOOP;
  ${owner==="dsh"?`FOR g IN SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='${schema}' AND c.relkind IN('r','S') AND to_regclass(format('%I.%I','${archive}',c.relname)) IS NULL LOOP
    EXECUTE format('GRANT %s ON %s %I.%I TO %I',CASE WHEN g.relkind='S' THEN 'USAGE' ELSE 'SELECT,INSERT,UPDATE,DELETE' END,CASE WHEN g.relkind='S' THEN 'SEQUENCE' ELSE 'TABLE' END,'${schema}',g.relname,'${d.runtime}');
  END LOOP;`:""}`:""}
  IF EXISTS(SELECT 1 FROM pg_class a JOIN pg_namespace ns ON ns.oid=a.relnamespace JOIN pg_class b ON b.relname=a.relname AND b.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='${schema}') CROSS JOIN unnest(ARRAY[${roleList}]) role CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) priv WHERE ns.nspname='${archive}' AND a.relkind IN('r','v') AND has_table_privilege(role,a.oid,priv)<>has_table_privilege(role,b.oid,priv)) OR
     EXISTS(SELECT 1 FROM pg_class a JOIN pg_namespace ns ON ns.oid=a.relnamespace JOIN pg_class b ON b.relname=a.relname AND b.relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='${schema}') JOIN pg_attribute x ON x.attrelid=a.oid AND x.attnum>0 AND NOT x.attisdropped JOIN pg_attribute y ON y.attrelid=b.oid AND y.attname=x.attname AND y.attnum>0 AND NOT y.attisdropped CROSS JOIN unnest(ARRAY[${roleList}]) role CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) priv WHERE ns.nspname='${archive}' AND a.relkind IN('r','v') AND has_column_privilege(role,a.oid,x.attnum,priv)<>has_column_privilege(role,b.oid,y.attnum,priv)) THEN RAISE EXCEPTION 'owner runtime ACL parity failed'; END IF;
END $bthwani_copy$;`,
`REVOKE ALL ON SCHEMA ${archive} FROM PUBLIC,${roleNames};`,
`REVOKE ALL ON ALL TABLES IN SCHEMA ${archive} FROM PUBLIC,${roleNames};`,
`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${archive} FROM PUBLIC,${roleNames};`,
`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${archive} FROM PUBLIC,${roleNames};`,
"RESET ROLE;",
`DO $bthwani_final$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()) OR
    EXISTS(SELECT 1 FROM unnest(ARRAY[${roleList}]) role WHERE has_schema_privilege(role,'${archive}','USAGE,CREATE')) OR
    NOT has_schema_privilege('${d.runtime}','${schema}','USAGE') OR has_schema_privilege('${d.runtime}','${schema}','CREATE')
    THEN RAISE EXCEPTION 'owner exclusive handoff or archived scope failed'; END IF;
END $bthwani_final$;`,
"COMMIT;",
"SELECT 'OWNER_BASELINE_TRANSITION_PASS';"
].filter(Boolean).join("\n");
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,owner,schema,archive,...rest]=process.argv.slice(2);
  if(mode!=="--fixture-sql"||rest.length)throw new Error("Expected --fixture-sql OWNER SCHEMA ARCHIVE");
  process.stdout.write(buildOwnerBaselineTransition(owner,schema,archive));
}
