FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# --timeout-keep-alive 30 — освобождает зависшие idle-коннекшены от nginx,
#   чтобы они не копились до исчерпания файловых дескрипторов.
# --limit-concurrency 200 — жёсткий потолок одновременных запросов в воркер.
#   При превышении uvicorn возвращает 503 вместо тихого скапливания очереди
#   и потенциального event-loop голодания.
# ProxyHeadersMiddleware подключён в main.py — флаг --proxy-headers тут не
#   нужен, иначе X-Forwarded-* обрабатывались бы дважды.
CMD ["uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--timeout-keep-alive", "30", \
     "--limit-concurrency", "200"]
