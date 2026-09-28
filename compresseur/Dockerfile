FROM alpine:3.20
# sqlite sert à la purge des exécutions n8n, lancée par lancer-veille.sh dans un
# conteneur jetable tiré de cette image. Elle est embarquée ici plutôt que
# téléchargée à chaque passage : la purge doit marcher même sans réseau.
RUN apk add --no-cache ghostscript python3 sqlite
COPY serveur.py /serveur.py
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1
CMD ["python3", "-u", "/serveur.py"]
