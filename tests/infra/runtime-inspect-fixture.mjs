// Independent synthetic Engine 29 inspection fixtures. No production validator
// is used to manufacture the records it is supposed to reject or admit.
export function nativeInspect(row,model,service) {
  row.Id ??= "a".repeat(64);
  row.Name ??= "/bthwani-refoundation-"+service+"-1";
  row.State ??= {Running:true,Status:"running"};
  const host=row.HostConfig,config=row.Config,definition=model.services[service];
  Object.assign(host,{
    ContainerIDFile:"",AutoRemove:false,VolumeDriver:"",CgroupnsMode:"private",IpcMode:"private",Cgroup:"",
    OomScoreAdj:0,PidMode:"",PublishAllPorts:false,UTSMode:"",UsernsMode:"",ShmSize:67108864,Runtime:"runc",Isolation:"",
    CpuShares:0,NanoCpus:0,CgroupParent:"",BlkioWeight:0,CpuPeriod:0,CpuQuota:0,CpuRealtimePeriod:0,CpuRealtimeRuntime:0,
    CpusetCpus:"",CpusetMems:"",MemoryReservation:0,CpuCount:0,CpuPercent:0,IOMaximumIOps:0,IOMaximumBandwidth:0,
    ConsoleSize:[0,0],MaskedPaths:["/proc/acpi","/proc/asound","/proc/interrupts","/proc/kcore","/proc/keys","/proc/latency_stats","/proc/sched_debug","/proc/scsi","/proc/timer_list","/proc/timer_stats","/sys/devices/virtual/powercap","/sys/firmware"],
    ReadonlyPaths:["/proc/bus","/proc/fs","/proc/irq","/proc/sys","/proc/sysrq-trigger"],
    NetworkMode:Object.keys(row.NetworkSettings.Networks)[0] ?? "default",
    Binds:row.Mounts.map(m=>m.Name+":"+m.Destination+":"+(m.RW?"rw":"ro")),
    RestartPolicy:{...host.RestartPolicy,MaximumRetryCount:0},
  });
  for(const mount of row.Mounts) {
    mount.Mode=mount.RW?"rw":"ro";mount.Propagation="";mount.Source??="/fixture/"+mount.Name;
  }
  Object.assign(config,{Hostname:row.Id.slice(0,12),Domainname:"",AttachStdin:false,AttachStdout:true,AttachStderr:true,
    Tty:false,OpenStdin:false,StdinOnce:false,Image:config.Image??"fixture:fixed",
    ExposedPorts:Object.fromEntries((definition.ports??[]).map(p=>[p.target+"/"+p.protocol,{}]))});
  config.Labels??={};
  config.Labels["com.docker.compose.service"]??=service;
  for(const [name,endpoint] of Object.entries(row.NetworkSettings.Networks)){
    const internal=Object.values(model.networks).find(n=>n.name===name)?.internal;
    const running=row.State.Running;
    Object.assign(endpoint,{NetworkID:endpoint.NetworkID??"e".repeat(64),Aliases:[row.Name.slice(1),service],
      IPAMConfig:null,Links:null,DriverOpts:null,GwPriority:0,EndpointID:running?row.Id:"",Gateway:running&&!internal?"172.18.0.1":"",
      IPAddress:running?"172.18.0."+((Number.parseInt(row.Id.slice(0,2),16)%250)+2):"",
      MacAddress:running?"02:42:ac:12:00:02":"",IPPrefixLen:running?16:0,IPv6Gateway:"",GlobalIPv6Address:"",
      GlobalIPv6PrefixLen:0,DNSNames:[row.Name.slice(1),service,row.Id.slice(0,12)]});
  }
  return row;
}
export function nativeNetwork(model,name,id,rows) {
  const [key,def]=Object.entries(model.networks).find(([,n])=>n.name===name);
  return {Name:name,Id:id,Created:"2026-11-26",Scope:"local",Driver:"bridge",Internal:Boolean(def.internal),
    EnableIPv4:true,EnableIPv6:false,Attachable:false,Ingress:false,ConfigOnly:false,ConfigFrom:{Network:""},
    Options:{"com.docker.network.enable_ipv4":"true","com.docker.network.enable_ipv6":"false"},
    IPAM:{Driver:"default",Options:null,Config:[{Subnet:"172.18.0.0/16",Gateway:"172.18.0.1"}]},
    Labels:{"com.docker.compose.project":"bthwani-refoundation","com.docker.compose.network":key,"com.docker.compose.config-hash":"a".repeat(64),"com.docker.compose.version":"5.6.1"},
    Containers:Object.fromEntries(rows.filter(r=>r.State.Running&&r.NetworkSettings.Networks[name]).map(r=>{
      const endpoint=r.NetworkSettings.Networks[name];
      return [r.Id,{Name:r.Name.slice(1),EndpointID:endpoint.EndpointID,MacAddress:endpoint.MacAddress,
        IPv4Address:endpoint.IPAddress+"/"+endpoint.IPPrefixLen,IPv6Address:""}];
    }))};
}