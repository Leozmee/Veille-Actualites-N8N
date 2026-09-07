FROM alpine:3.20
RUN apk add --no-cache ghostscript python3
COPY serveur.py /serveur.py
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["python3", "-u", "/serveur.py"]
