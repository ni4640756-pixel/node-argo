const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const net = require('net');

// ================= 1. 配置 =================
const UUID = process.env.UUID || '0dff8b4c-f778-4648-8817-3a434f7fa443';
// 必须监听这个环境变量提供的端口！
const PORT = process.env.PORT || 8080; 
// Xray 在内部监听的端口 (不对外)
const INTERNAL_PORT = 12345; 

const APP_DIR = path.join(__dirname, 'sap_app');
if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR);

// ================= 2. 核心：Node.js 流量分发器 =================
const server = http.createServer((req, res) => {
    // A. 普通网页请求 (健康检查) -> 返回 200
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>SAP Direct is Running</h1>');
    } else {
        res.writeHead(200);
        res.end('OK');
    }
});

// B. WebSocket 升级请求 (VLESS 流量) -> 转发给 Xray
server.on('upgrade', (req, socket, head) => {
    if (req.url == '/vless') { // 路径匹配
        // 连接内部的 Xray
        const client = net.createConnection({ port: INTERNAL_PORT }, () => {
            client.write(head);
            socket.pipe(client);
            client.pipe(socket);
        });
        
        client.on('error', (err) => {
            socket.destroy();
        });
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log(`[Node] Listening on port ${PORT}`);
    startXray();
});

// ================= 3. 启动 Xray (内部模式) =================
async function startXray() {
    const coreBin = path.join(APP_DIR, 'web');
    const configFile = path.join(APP_DIR, 'config.json');

    // 下载 Xray
    const arch = ['arm', 'arm64', 'aarch64'].includes(process.arch) ? 'arm64' : 'amd64';
    await download(`https://${arch}.ssss.nyc.mn/web`, coreBin);
    
    // 赋权
    try { fs.chmodSync(coreBin, 0o755); } catch (e) { try { execSync(`chmod +x ${coreBin}`); } catch (e) {} }

    // 生成配置：注意！这里监听的是 INTERNAL_PORT (12345)
    const config = {
        log: { loglevel: "none" }, // 关闭日志省内存
        inbounds: [{
            port: INTERNAL_PORT,
            listen: "127.0.0.1",
            protocol: "vless",
            settings: { clients: [{ id: UUID }], decryption: "none" },
            streamSettings: { network: "ws", wsSettings: { path: "/vless" } }
        }],
        outbounds: [{ protocol: "freedom" }]
    };
    fs.writeFileSync(configFile, JSON.stringify(config));

    // 启动 (限制内存 50MB)
    const xray = spawn(coreBin, ['-c', configFile], {
        stdio: 'inherit',
        env: { ...process.env, GOMEMLIMIT: '50MiB' }
    });
    
    console.log(`[Xray] Started on internal port ${INTERNAL_PORT}`);
}

function download(url, dest) {
    return new Promise((resolve) => {
        if (fs.existsSync(dest)) return resolve();
        const file = fs.createWriteStream(dest);
        https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', () => resolve());
    });
}
