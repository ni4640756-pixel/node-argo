# 1. 选择基础镜像 (我们之前商定的 Node.js 20)
# 使用 slim 版本体积更小，但保留了 Debian 基础工具
FROM node:20-bullseye-slim

# 2. 设置容器内的工作目录
WORKDIR /app

# 3. 安装必要的系统工具
# 您的 app.js 需要用到 curl 和 tar 来下载内核，slim 镜像可能不带，所以由于必须手动安装
RUN apt-get update && apt-get install -y curl tar && rm -rf /var/lib/apt/lists/*

# 4. 复制依赖文件并安装
# 先复制 package.json 是为了利用 Docker 缓存，加快构建速度
COPY package.json .
RUN npm install --production

# 5. 复制所有源代码到容器里
COPY . .

# 6. 暴露端口 (虽然是隧道，但我们要暴露 Web 端口看订阅)
EXPOSE 3000

# 7. 启动命令
CMD ["node", "index.js"]
