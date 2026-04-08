# Simple Data Table

A simple static website with a sortable data table, built with 11ty and deployed to GitHub Pages.

## Features

- Responsive data table with sorting
- Data loaded from JSON
- Clean and simple UI
- Deployed on GitHub Pages
- Daily automated data scraping via GitHub Actions

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Start development server: `npm start`
4. Open `http://localhost:8080` in your browser

## Running the Scraper Locally

1. Install Playwright browsers: `npx playwright install chromium`
2. Run the scraper: `npm run scrape-beers`
3. The scraper updates `src/_data/beers.json`

## Deployment

This project deploys automatically to GitHub Pages:

1. **On every push to `master`**: GitHub Actions builds the 11ty site and deploys to Pages
2. **Daily at 05:30 UTC**: A scheduled workflow scrapes fresh beer data and commits any changes, triggering a redeploy

### Initial Setup

1. Push this repository to GitHub
2. Go to **Settings > Pages > Source** and select **GitHub Actions**
3. The next push to `master` will deploy the site

## Technologies Used

- [11ty](https://www.11ty.dev/) - Static site generator
- [Nunjucks](https://mozilla.github.io/nunjucks/) - Templating engine
- Vanilla JavaScript - For table sorting
- [Playwright](https://playwright.dev/) - Browser automation for data scraping
- [GitHub Actions](https://github.com/features/actions) - CI/CD and scheduled scraping
