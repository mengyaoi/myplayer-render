FROM python:3.12-slim

WORKDIR /app

COPY . /app

# 监听端口由环境变量 PORT 控制（Render 会自动注入，请勿在此写死具体端口）
# 默认 8010 仅用于本地 docker run 未指定 PORT 时的兜底
ENV PORT=8010

EXPOSE 8010

CMD ["python", "tools/serve.py"]
