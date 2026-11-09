// LAN-only transport to the existing loopback administrator UI; no credential is served here.
const {createServer,request}=require('node:http')
const {isIPv4}=require('node:net')
const {resolve}=require('node:path')
function ipv4(value){return isIPv4(value)?value.split('.').reduce((n,v)=>(n*256+Number(v))>>>0,0):null}
function inSubnet(address,cidr){
  const ip=ipv4((address??'').replace(/^::ffff:/,'')),[network,bits]=cidr.split('/'),base=ipv4(network),prefix=Number(bits)
  return ip!==null&&base!==null&&Number.isInteger(prefix)&&prefix>=8&&prefix<=32&&((ip&(-1<<(32-prefix)))>>>0)===((base&(-1<<(32-prefix)))>>>0)
}
function safePath(raw,project){
  if(!raw?.startsWith('/')||raw.startsWith('//'))return false
  let path;try{path=decodeURIComponent(raw.split('?')[0])}catch{return false}
  if(/[\\\0%]/.test(path)||path.split('/').some((p,i,parts)=>p==='..'||p.startsWith('.')&&!(p==='.vite'&&parts[i-1]==='node_modules')))return false
  if(path.split('/').some(p=>['output','scripts','docs','data-entry'].includes(p.toLowerCase()))||/\.(?:local|env)(?:\..*)?$/i.test(path))return false
  if(path==='/'||path==='/index.html')return true
  if(/^\/(?:api|src|node_modules|static|assets|@vite|@id)\//.test(path))return true
  const prefix='/@fs/'+resolve(project).replace(/\\/g,'/')+'/'
  return path.toLowerCase().startsWith(prefix.toLowerCase())&&/^(?:node_modules|src)\//.test(path.slice(prefix.length))
}
function createLanAdminGateway({host,port=5191,subnet,project,upstreamPort=5191}){
  if(!isIPv4(host)||!inSubnet(host,subnet))throw new Error('LAN address/subnet mismatch')
  const origin=`http://${host}:${port}`,localOrigin=`http://127.0.0.1:${upstreamPort}`
  const permitted=req=>inSubnet(req.socket.remoteAddress,subnet)&&req.headers.host===`${host}:${port}`&&(!req.headers.origin||req.headers.origin===origin)&&(!req.headers['sec-fetch-site']||['same-origin','none'].includes(req.headers['sec-fetch-site']))
  const denied=(res,status=403)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify({error:'仅允许指定局域网的同源管理页面访问'}))}
  const server=createServer((req,res)=>{
    if(!permitted(req))return denied(res)
    if(!safePath(req.url,project)||!['GET','HEAD','POST'].includes(req.method))return denied(res,404)
    const api=req.url.startsWith('/api/')
    if(req.method==='POST'&&(!api||req.headers.origin!==origin))return denied(res)
    const upstream=request({host:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,headers:{Host:`127.0.0.1:${upstreamPort}`,Origin:localOrigin,'Sec-Fetch-Site':'same-origin',...(req.headers.accept?{Accept:req.headers.accept}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{}),...(req.headers['content-length']?{'Content-Length':req.headers['content-length']}:{} )}},incoming=>{
      res.writeHead(incoming.statusCode??502,{'Content-Type':incoming.headers['content-type']??'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(incoming.headers['content-disposition']?{'Content-Disposition':incoming.headers['content-disposition']}:{} )});incoming.pipe(res)
    })
    upstream.setTimeout(api?120000:30000,()=>upstream.destroy())
    upstream.on('error',()=>{if(!res.headersSent)denied(res,503);else res.destroy()});req.on('aborted',()=>upstream.destroy());req.pipe(upstream)
  })
  server.on('upgrade',(req,socket,head)=>{
    if(!permitted(req)||req.headers.origin!==origin||req.url?.split('?')[0]!=='/'||req.headers['sec-websocket-protocol']!=='vite-hmr'){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return}
    const upstream=request({host:'127.0.0.1',port:upstreamPort,path:req.url,headers:{Host:`127.0.0.1:${upstreamPort}`,Origin:localOrigin,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':req.headers['sec-websocket-key'],'Sec-WebSocket-Version':'13','Sec-WebSocket-Protocol':'vite-hmr'}})
    upstream.on('upgrade',(response,remote,remoteHead)=>{
      socket.write('HTTP/1.1 101 Switching Protocols\r\n'+Object.entries(response.headers).map(([k,v])=>`${k}: ${v}\r\n`).join('')+'\r\n')
      if(remoteHead.length)socket.write(remoteHead);if(head.length)remote.write(head);remote.pipe(socket);socket.pipe(remote)
      socket.on('error',()=>remote.destroy());remote.on('error',()=>socket.destroy());socket.on('close',()=>remote.destroy());remote.on('close',()=>socket.destroy())
    });upstream.on('response',()=>socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));upstream.on('error',()=>socket.destroy());upstream.end()
  })
  return server
}
module.exports={createLanAdminGateway,inSubnet,safePath}
if(require.main===module){
  const args=process.argv.slice(2),get=name=>args[args.indexOf(name)+1]
  const host=get('--host'),subnet=get('--subnet'),project=get('--project')
  if(!/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host??'')||!project)throw new Error('Explicit private LAN address, subnet and project required')
  const server=createLanAdminGateway({host,subnet,project})
  server.on('error',e=>{console.error(e.message);process.exitCode=1})
  server.listen(5191,host,()=>console.log(`LAN administrator ready: http://${host}:5191/#/pages/maintenance/index?mode=admin (${subnet})`))
}
