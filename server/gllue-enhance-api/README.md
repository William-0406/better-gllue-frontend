# Gllue Enhance API

Private enhancement service for the browser extension. It stores only read-only candidate summaries and hashed contact signals.

## Run

```bash
docker build -t gllue-enhance-api .
docker run -d --name gllue-enhance-api \
  -p 3000:3000 \
  -v gllue-enhance-data:/data \
  gllue-enhance-api
```

Upload the extension package into the mounted data directory:

```bash
docker cp 更好的谷露前端.zip gllue-enhance-api:/data/extension.zip
```

Then open:

```text
http://<你们的增强服务器地址>/download
```

## Endpoints

- `GET /health`
- `GET /config`
- `GET /download`
- `GET /download/extension.zip`
- `POST /index/candidates/upsert`
- `POST /match/maimai`
- `POST /match/resume`
- `POST /diagnostics`
- `GET /projects`
- `POST /projects`
- `PATCH /projects/:id`
- `DELETE /projects/:id`

## 项目图谱（在招项目）

顾问手动维护的"当前在做的项目"列表，字段：`company`（公司）、`title`（职位）、`location`（base 地点）、`status`（`进行中` / `已结束`）、`owners`（负责顾问，字符串数组）、`notes`（备注）。不读谷露 joborder（名字大量是 undefined），全员可增删改任意项目。

```text
GET  /projects              → { ok, count, projects: [...] }
POST /projects               body: { company, title, location, status?, owners?, notes? } → { ok, project }
PATCH /projects/:id          body: 任意子集字段，只更新传入的字段 → { ok, project }
DELETE /projects/:id         → { ok, project }（被删除的记录）
```

## OCR（扫描件简历）

需要两个环境变量启用百度 OCR（缺任一则 /config 返回 ocr:false，/ocr/image 返回 503）：

- `BAIDU_OCR_API_KEY`
- `BAIDU_OCR_SECRET_KEY`
- 可选 `BAIDU_OCR_API`：默认 `accurate_basic`（高精度版）；设 `general_basic` 用便宜的标准版。
- 可选 `OCR_MAX_PAGES`：单份最多识别页数，默认 8。

接口：`POST /ocr/image`，body `{ "images": ["<base64 或 dataURL>", ...] }`，返回 `{ ok, text, pages }`。

部署示例：

    sudo docker run -d --name gllue-enhance-api -p 3100:3000 \
      -v gllue-enhance-data:/data \
      -e BAIDU_OCR_API_KEY=你的APIKey \
      -e BAIDU_OCR_SECRET_KEY=你的SecretKey \
      gllue-enhance-api
