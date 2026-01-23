FROM mcr.microsoft.com/playwright:v1.42.1-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npx playwright install --with-deps chromium

COPY . .

CMD ["node", "scraper.js"]
