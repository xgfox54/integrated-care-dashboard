// 파싱 워커용 네트워크 차단(코드 수준). node --import 로 먼저 불러 DNS·TCP·TLS·HTTP·fetch를 모두 거절한다.
// 운영체제 방화벽 수준의 격리는 아니다. 시도가 있으면 globalThis.__wfNetworkAttempts 에 센다.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

globalThis.__wfNetworkAttempts = 0;
function blocked(kind) {
  return function blockedNetwork() {
    globalThis.__wfNetworkAttempts += 1;
    throw new Error("WF_NETWORK_BLOCKED:" + kind);
  };
}

dns.lookup = blocked("dns.lookup");
dns.resolve = blocked("dns.resolve");
dns.promises.lookup = blocked("dns.promises.lookup");
dns.promises.resolve = blocked("dns.promises.resolve");
net.connect = blocked("net.connect");
net.createConnection = blocked("net.createConnection");
net.Socket.prototype.connect = blocked("net.Socket.connect");
tls.connect = blocked("tls.connect");
http.request = blocked("http.request");
http.get = blocked("http.get");
https.request = blocked("https.request");
https.get = blocked("https.get");
globalThis.fetch = async () => blocked("fetch")();
process.env.KORDOC_OFFLINE = "1";

