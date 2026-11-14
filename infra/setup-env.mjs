#!/usr/bin/env node
// Create random, local-only credentials once. Never display or replace secrets.
import { randomBytes } from 'node:crypto';
import { existsSync, lstatSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir=path.dirname(fileURLToPath(import.meta.url));
const dest=path.join(dir,'.env');
if(existsSync(dest)){
  if(!lstatSync(dest).isFile())throw Error('infra/.env is not a regular file');
  console.log('REFOUNDATION_ENV_EXISTS_UNTOUCHED');
  process.exit(0);
}
const secret=()=>randomBytes(32).toString('hex');
const lines=[
 '# Randomized local-only refoundation secrets. NEVER commit or reuse old credentials.',
 'REF_POSTGRES_USER=bthwani_refoundation_admin',
 'REF_POSTGRES_DB=bthwani_refoundation',
 'REF_POSTGRES_PASSWORD='+secret(),
 'REF_MEDIA_ACCESS_KEY='+secret(),
 'REF_MEDIA_SECRET_KEY='+secret(),
 'REF_MEDIA_BUCKET=bthwani-refoundation-media',
 'REF_MAILPIT_PORT=3226',
 'REF_MEDIA_PORT=3233',
 'REF_PAYMENT_MOCK_PORT=3290',
 'REF_IDENTITY_PORT=3201',
 'REF_DSH_PORT=3202',
 'REF_WLT_PORT=3203',
 'REF_CUSTOMER_PORT=3101',
 'REF_MERCHANT_PORT=3102',
 'REF_CAPTAIN_PORT=3103',
 'REF_OPERATOR_PORT=3104',
 ''
];
writeFileSync(dest,lines.join('\n'),{flag:'wx',encoding:'utf8',mode:0o600});
console.log('REFOUNDATION_ENV_CREATED_LOCAL_ONLY');
