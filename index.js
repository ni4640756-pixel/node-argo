const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const net = require('net');

// ================= 1. 配置区域 =================
const UUID = process.env.UUID || '0dff8b4c-f778-4648-8817-3a434f7fa443';
const PORT = process.env.PORT || 8080; 
const INTERNAL_PORT = 12345; 
const APP_DIR = path.join(__dirname, 'sap_app');

// ================= 2. 初始化环境 =================
if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR);

// ================= 3. 核心 Web 服务 (带订阅功能) =================
const server = http.createServer((req, res) => {
    
    // 自动获取访问的域名 (关键!)
    const host = req.headers.host;
    const vlessLink = `vless://${UUID}@${host}:443?encryption=none&security=tls&type=ws&host=${host}&path=%2Fvless#SAP-Direct-${host.split('.')[0]}`;

    // A. 首页：直接显示链接，方便手动复制
    if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<h3>SAP VLESS Direct Mode</h3>`);
        res.write(`<p>你的域名是: <strong>${host}</strong></p>`);
        res.write(`<hr/>`);
        res.write(`<h4>🚀 VLESS 链接 (点击全选复制):</h4>`);
        res.write(`<textarea style="width:100%; height:100px;">${vlessLink}</textarea>`);
        res.write(`<p>或者将本页面地址后面加上 <code>/sub</code> 作为订阅地址。</p>`);
        res.end();
    } 
    // B. 订阅页：返回 Base64 编码 (标准的订阅格式)
    else if (req.url === '/sub') {
        const base64Content = Buffer.from(vlessLink).toString('base64');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(base64Content);
    }
    // C. 健康检查 (Keep-Alive)
    else {
        res.writeHead(200);
        res.end('OK');
    }
});

// WebSocket 流量转发 (直连核心)
server.on('upgrade', (req, socket, head) => {
    if (req.url == '/vless') {
        const client = net.createConnection({ port: INTERNAL_PORT }, () => {
            client.write(head);
            socket.pipe(client);
            client.pipe(socket);
        });
        client.on('error', (err) => socket.destroy());
    } else {
        socket.destroy();
    }
});

server.listen(PORT, () => {
    console.log(`[Node] Listening on port ${PORT}`);
    startXray();
});

// ================= 4. 启动 Xray =================
async function startXray() {
    const coreBin = path.join(APP_DIR, 'web');
    const configFile = path.join(APP_DIR, 'config.json');
    const arch = ['arm', 'arm64', 'aarch64'].includes(process.arch) ? 'arm64' : 'amd64';

    await download(`https://${arch}.ssss.nyc.mn/web`, coreBin);
    try { fs.chmodSync(coreBin, 0o755); } catch (e) { try { execSync(`chmod +x ${coreBin}`); } catch (e) {} }

    const config = {
        log: { loglevel: "none" },
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

    spawn(coreBin, ['-c', configFile], {
        stdio: 'inherit',
        env: { ...process.env, GOMEMLIMIT: '50MiB' }
    });
    console.log(`[Xray] Core Started.`);
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
