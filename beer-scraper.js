const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);
const maxProductsArg = args.find(arg => arg.startsWith('--max-products='));
const maxProducts = maxProductsArg ? parseInt(maxProductsArg.split('=')[1], 10) : Infinity;
const verbose = args.includes('--verbose');

// Logger function that respects verbose flag
function log(...args) {
    if (verbose) {
        console.log(...args);
    }
}

// Error logging is always shown
function logError(...args) {
    console.error(...args);
}

// Helper function to auto-scroll the page to load all products
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

const BROWSER_OPTIONS = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris'
};

// Helper function to extract EAN from product page
async function extractEAN(page) {
    try {
        return await page.evaluate(() => {
            // First try to find the EAN in the product details section
            const details = Array.from(document.querySelectorAll('div, p, span, li, td'))
                .find(el => el.textContent && el.textContent.includes('Réf / EAN :'));

            if (details) {
                const eanMatch = details.textContent.match(/Réf \/ EAN :[^\d]*(\d{13})/);
                if (eanMatch && eanMatch[1]) {
                    return eanMatch[1];
                }

                const nextSibling = details.nextElementSibling;
                if (nextSibling) {
                    const siblingEan = nextSibling.textContent.trim();
                    if (/^\d{13}$/.test(siblingEan)) {
                        return siblingEan;
                    }
                }
            }

            // Fallback: find any 13-digit number on the page
            const allText = document.body.textContent;
            const eanMatch = allText.match(/\b\d{13}\b/);
            return eanMatch ? eanMatch[0] : null;
        });
    } catch (error) {
        logError('Error extracting EAN:', error);
        return null;
    }
}

// Helper function to extract sucres with retries
async function extractSucresWithRetry(page, maxRetries = 3) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await page.evaluate(() => {
                const nutritionSection = Array.from(document.querySelectorAll('h2, h3, h4, div, section'))
                    .find(el => el.textContent && el.textContent.toLowerCase().includes('valeurs nutritionnelles'));

                if (nutritionSection) {
                    const sectionText = nutritionSection.textContent;
                    const sucresMatch = sectionText.match(/sucres?[^\d]*([\d]+[.,]?[\d]*)\s*[gG]/i);

                    if (sucresMatch && sucresMatch[1]) {
                        return sucresMatch[1].replace(',', '.');
                    }

                    const sectionElement = nutritionSection.nextElementSibling ||
                        nutritionSection.parentElement;

                    if (sectionElement) {
                        const allText = sectionElement.textContent.toLowerCase();
                        const textMatch = allText.match(/sucres?[^\d]*([\d]+[.,]?[\d]*)\s*[gG]/i);
                        if (textMatch && textMatch[1]) {
                            return textMatch[1].replace(',', '.');
                        }
                    }
                }
                return null;
            });

            if (result !== null) return result;

            // If null on first attempts, wait for lazy content and retry
            if (attempt < maxRetries) {
                await page.waitForTimeout(1000 * attempt);
            }
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries) {
                await page.waitForTimeout(1000 * attempt);
            }
        }
    }

    logError(`Failed to extract sucres after ${maxRetries} attempts:`, lastError?.message || 'No data found');
    return null;
}

async function fetchBeerNames() {
    const browser = await chromium.launch({ headless: true });

    try {
        const context = await browser.newContext(BROWSER_OPTIONS);
        const page = await context.newPage();

        console.log('Navigating to Auchan website...');
        await page.goto('https://www.auchan.fr/vins-bieres-alcool/bieres-futs-cidres/bieres-sans-alcool-panaches/ca-n071209', {
            waitUntil: 'domcontentloaded',
            timeout: 60000
        });

        if (verbose) {
            await page.screenshot({ path: 'debug-initial.png', fullPage: true });
        }

        // Accept cookies if the banner appears
        try {
            await page.click('button#onetrust-accept-btn-handler', { timeout: 5000 });
            console.log('Accepted cookies');
        } catch (e) {
            console.log('No cookie banner found or already accepted');
        }

        console.log('Waiting for products to load...');
        try {
            await page.waitForSelector('.product-thumbnail__description', {
                timeout: 30000,
                state: 'attached'
            });
            console.log('Found products');
        } catch (error) {
            console.warn('Could not find products with primary selector, trying alternatives...');
            try {
                await page.waitForSelector([
                    '.product-card',
                    '.product-item',
                    '[data-testid*="product"]',
                    '.product-list',
                    '.product-grid',
                    '.product-container'
                ].join(','), {
                    timeout: 15000,
                    state: 'attached'
                });
            } catch (fallbackError) {
                console.warn('Could not find product container, proceeding anyway');
                if (verbose) {
                    const content = await page.content();
                    fs.writeFileSync('debug-page.html', content);
                    console.log('Saved debug-page.html');
                }
            }
        }

        console.log('Scrolling to load all products...');
        await autoScroll(page);

        // Wait for any lazy-loaded content after scroll
        await page.waitForSelector('.product-thumbnail__description', { timeout: 5000 }).catch(() => {});

        if (verbose) {
            await page.screenshot({ path: 'debug-before-extract.png', fullPage: true });
        }

        console.log('Extracting products...');

        // Get all product links and basic info
        const products = await page.$$eval('.product-thumbnail__description', elements =>
            elements.map(el => {
                const brandElement = el.querySelector('strong');
                const brand = brandElement ? brandElement.textContent.trim() : '';
                const fullText = el.textContent.trim();
                const description = brand ?
                    fullText.replace(brand, '').replace(/^\s*-?\s*/, '').trim() :
                    fullText;
                const linkElement = el.closest('a[href]');

                return {
                    brand,
                    description,
                    url: linkElement ? linkElement.href : null
                };
            })
        );

        console.log(`Found ${products.length} products`);

        await page.close();

        const numProductsToProcess = Math.min(products.length, maxProducts);
        const productsToProcess = products.slice(0, numProductsToProcess);
        console.log(`Processing ${numProductsToProcess} products${maxProducts < products.length ? ` (limited from ${products.length})` : ''}`);

        const concurrency = 5;

        for (let i = 0; i < productsToProcess.length; i += concurrency) {
            const chunk = productsToProcess.slice(i, i + concurrency);

            await Promise.all(chunk.map(async (product, chunkIndex) => {
                const productNum = i + chunkIndex + 1;
                if (!product.url) return;

                const detailPage = await context.newPage();

                try {
                    log(`[${productNum}/${numProductsToProcess}] ${product.brand} - ${product.description}`);

                    await detailPage.goto(product.url, {
                        waitUntil: 'domcontentloaded',
                        timeout: 30000
                    });

                    const [ean, sucresValue] = await Promise.all([
                        extractEAN(detailPage),
                        extractSucresWithRetry(detailPage)
                    ]);

                    if (ean) {
                        log(`[${productNum}] EAN: ${ean}`);
                        product.ean = ean;
                    }

                    if (sucresValue !== null) {
                        const sucresNumber = parseFloat(sucresValue);
                        product.nutritionalInfo = {
                            sucres: isNaN(sucresNumber) ? sucresValue : sucresNumber
                        };
                    }

                    log(`[${productNum}] Sucres: ${sucresValue}`);

                } catch (error) {
                    logError(`[${productNum}] Error processing ${product.brand}:`, error.message);
                } finally {
                    await detailPage.close();
                }
            }));

            if (i + concurrency < productsToProcess.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        const beersData = products
            .map(product => ({
                brand: product.brand,
                description: product.description,
                ean: product.ean || null,
                nutritionalInfo: {
                    sucres: product.nutritionalInfo?.sucres ?? null
                }
            }))
            .sort((a, b) => {
                const aSucres = a.nutritionalInfo.sucres === null ? Infinity : a.nutritionalInfo.sucres;
                const bSucres = b.nutritionalInfo.sucres === null ? Infinity : b.nutritionalInfo.sucres;
                return aSucres - bSucres;
            });

        // Save to src/_data/beers.json
        const dataDir = path.join('src', '_data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const beersJsonPath = path.join(dataDir, 'beers.json');
        fs.writeFileSync(beersJsonPath, JSON.stringify(beersData, null, 2));

        const metaJsonPath = path.join(dataDir, 'meta.json');
        fs.writeFileSync(metaJsonPath, JSON.stringify({ updatedAt: new Date().toISOString() }, null, 2));

        console.log(`Saved ${beersData.length} beers to ${beersJsonPath}`);

        if (verbose) {
            const logsDir = path.join('logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logFilePath = path.join(logsDir, `beers-${timestamp}.json`);
            fs.writeFileSync(logFilePath, JSON.stringify(beersData, null, 2));
            log(`Saved backup to ${logFilePath}`);
        }

        return products;

    } catch (error) {
        logError('Error during scraping:', error);
        return [];
    } finally {
        await browser.close();
    }
}

(async () => {
    try {
        await fetchBeerNames();
    } catch (error) {
        logError('Unhandled error:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
})();
