# Navigateur dédié à LinkedIn : un Chromium sans écran, son profil sur un volume,
# son trafic sortant uniquement par le proxy résidentiel.
#
# Le worker le pilote en CDP (puppeteer-core) ; ce conteneur ne contient aucune
# clé et ne doit en recevoir aucune de plus que le nécessaire (voir l'entrypoint).

FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium socat curl ca-certificates fonts-liberation tini \
 && rm -rf /var/lib/apt/lists/*

# Utilisateur non privilégié. Le volume du profil hérite de ce propriétaire à sa création.
RUN useradd --create-home --uid 10001 navigateur \
 && mkdir /profil && chown navigateur:navigateur /profil
USER navigateur

COPY --chown=navigateur:navigateur entrypoint.sh /entrypoint.sh
RUN chmod 0755 /entrypoint.sh

VOLUME /profil
# 9222 : DevTools de Chromium, uniquement sur 127.0.0.1 du conteneur.
# 9223 : relais socat vers 9222, pour que le worker le joigne sur le réseau du compose.
EXPOSE 9223

ENTRYPOINT ["/usr/bin/tini", "--", "/entrypoint.sh"]
