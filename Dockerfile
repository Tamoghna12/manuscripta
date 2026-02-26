# ── Stage 1: Build frontend ──
FROM node:20-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json

RUN npm ci --ignore-scripts

COPY apps/frontend/ apps/frontend/
RUN npm --workspace apps/frontend run build

# ── Stage 2: Production ──
# Use Debian-based image for TeX Live + system tools compatibility
FROM node:20-bookworm-slim

# Install TeX Live (scheme-basic + commonly needed packages), Python, zip utils
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-base \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-bibtex-extra \
    texlive-science \
    texlive-xetex \
    texlive-luatex \
    texlive-plain-generic \
    latexmk \
    biber \
    python3 \
    python3-matplotlib \
    python3-numpy \
    zip \
    unzip \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json

RUN npm ci --omit=dev --ignore-scripts

COPY apps/backend/ apps/backend/
COPY templates/ templates/
COPY --from=build /app/apps/frontend/dist apps/frontend/dist

# Set Python path for plot service
ENV MANUSCRIPTA_PYTHON=/usr/bin/python3
ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "apps/backend/src/index.js"]
