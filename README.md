# Simple Data Table

A simple static website with a sortable data table, built with 11ty and deployed to Bitbucket Pages.

## Features

- Responsive data table with sorting
- Data loaded from JSON
- Clean and simple UI
- Deployed on Bitbucket Pages

## Local Development

1. Clone the repository
2. Install dependencies: `npm install`
3. Start development server: `npm start`
4. Open `http://localhost:8080` in your browser

## Deployment

This project is set up to be deployed on Bitbucket Pages:

1. Push your code to a Bitbucket repository
2. Enable Bitbucket Pipelines in the repository settings
3. Set up the following repository variables in Bitbucket:
   - `BITBUCKET_USERNAME`: Your Bitbucket username
   - `BITBUCKET_APP_PASSWORD`: An app password with repository write access
   - `ACCESS_KEY`: AWS access key (if using S3 for hosting)
   - `SECRET_ACCESS_KEY`: AWS secret key (if using S3 for hosting)
   - `BUCKET`: S3 bucket name (if using S3 for hosting)

## Technologies Used

- [11ty](https://www.11ty.dev/) - Static site generator
- [Nunjucks](https://mozilla.github.io/nunjucks/) - Templating engine
- Vanilla JavaScript - For table sorting
- [Bitbucket Pipelines](https://bitbucket.org/product/features/pipelines) - CI/CD
