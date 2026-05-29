FROM ghcr.io/puppeteer/puppeteer:latest

# Cambiar a usuario root para configurar la app
USER root
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto de tu app
EXPOSE 3000

# Comando para iniciar el servidor
CMD ["node", "server.js"]