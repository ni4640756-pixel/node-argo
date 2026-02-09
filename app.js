const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ================= 环境变量配置 =================
// 必填：你的 UUID
const UUID = process.env.UUID || '0dff8b4c-f778-4648-8817-3a434f7fa443';
// 必填：Cloudflare Tunnel Token
const ARGO_AUTH = process.env.ARGO_AUTH || ''; 
// 必填：你的域名 (用于生成链接)
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';

const PORT = process.env.PORT || 3000; 
// 必须优先使用 process.env.PORT
const FILE_PATH = './tmp';

// ================= 初始化目录 =================
if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH);

// ================= 1. 极简 HTTP 服务 (替代 Express) =================
// 只有 10 行代码，内存占用极低
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('VLESS Worker is Alive.\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, () => {
  console.log(`Lite Server running on port ${PORT}`);
  startService(); // 服务启动后，开始下载和运行节点
});

// ================= 2. 核心逻辑 =================
async function startService() {
  const webPath = path.join(FILE_PATH, 'web'); // xray/sing-box
  const botPath = path.join(FILE_PATH, 'bot'); // cloudflared
  const configPath = path.join(FILE_PATH, 'config.json');

  // A. 下载依赖 (原生 https，不依赖 axios)
  await downloadFile(`https://${getArch()}.ssss.nyc.mn/web`, webPath);
  await downloadFile(`https://${getArch()}.ssss.nyc.mn/bot`, botPath);

  // B. 生成 VLESS 配置 (监听 8080)
  const config = {
    log: { loglevel: "none" },
    inbounds: [{
      port: 8080,
      listen: "127.0.0.1",
      protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: { network: "ws", wsSettings: { path: "/vless" } }
    }],
    outbounds: [{ protocol: "freedom" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config));

  // C. 启动进程 (关键！内存锁)
  // Xray/Sing-box: 限制 25MB
  runProcess(webPath, ['-c', configPath], 'Core', '25MiB');

  // Cloudflared: 限制 40MB
  if (ARGO_AUTH) {
    runProcess(botPath, 
      ['tunnel', '--edge-ip-version', 'auto', '--no-autoupdate', '--protocol', 'http2', 'run', '--token', ARGO_AUTH], 
      'Tunnel', '40MiB'
    );
  } else {
    console.log('❌ 未检测到 ARGO_AUTH，隧道无法启动！');
  }

  // D. 打印订阅链接
  setTimeout(() => {
    console.log('\n=======================================');
    console.log(`🔗 VLESS 链接:`);
    console.log(`vless://${UUID}@www.visa.com.sg:443?encryption=none&security=tls&sni=${ARGO_DOMAIN}&type=ws&host=${ARGO_DOMAIN}&path=%2Fvless#Node-100MB`);
    console.log('=======================================\n');
  }, 5000);
}

// ================= 辅助函数 =================

// 1. 进程启动器 (带 GOMEMLIMIT)
function runProcess(command, args, name, memLimit) {
  // 设置权限
  try { fs.chmodSync(command, 0o775); } catch (e) {}

  const child = spawn(command, args, {
    stdio: 'inherit', // 直接输出日志到控制台，不缓存
    env: {
      ...process.env,
      GOGC: '10',         // 激进回收：垃圾增加 10% 就回收
      GOMEMLIMIT: memLimit // 硬限：超过这个值强制 GC，绝不溢出
    }
  });

  console.log(`🚀 ${name} started with limit: ${memLimit}`);
  
  child.on('exit', (code) => {
    console.log(`⚠️ ${name} exited with code ${code}`);
    // 如果核心进程挂了，杀掉整个容器重启，防止僵尸进程
    process.exit(1);
  });
}

// 2. 原生下载器
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      console.log(`[Skip] ${path.basename(dest)} exists.`);
      return resolve();
    }
    console.log(`[Down] Downloading ${path.basename(dest)}...`);
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err.message);
    });
  });
}

// 3. 架构判断
function getArch() {
  const arch = process.arch;
  return ['arm', 'arm64', 'aarch64'].includes(arch) ? 'arm64' : 'amd64';
}
