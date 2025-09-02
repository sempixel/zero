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

async function fetchBeerNames() {
    const browser = await chromium.launch({headless: true});

    try {
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            viewport: {width: 1920, height: 1080},
            locale: 'fr-FR',
            timezoneId: 'Europe/Paris'
        });

        const page = await context.newPage();

        console.log('Navigating to Auchan website...');
        await page.goto('https://www.auchan.fr/vins-bieres-alcool/bieres-futs-cidres/bieres-sans-alcool-panaches/ca-n071209', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        // Save initial page content for debugging
        await page.screenshot({path: 'debug-initial.png', fullPage: true});

        // Accept cookies if the banner appears
        try {
            await page.click('button#onetrust-accept-btn-handler', {timeout: 5000});
            console.log('Accepted cookies');
            await page.waitForTimeout(2000); // Wait for the page to settle
        } catch (e) {
            console.log('No cookie banner found or already accepted');
        }

        console.log('Waiting for products to load...');
        // More flexible wait for any content that might indicate products
        try {
            // Try to find any product-related elements with multiple possible selectors
            await page.waitForSelector([
                '.product-card',
                '.product-item',
                '[data-testid*="product"]',
                '.product-list',
                '.product-grid',
                '.product-container'
            ].join(','), {
                timeout: 30000, // Increased timeout to 30 seconds
                state: 'attached' // Don't require visibility, just presence in DOM
            });

            console.log('Found product container, checking for individual products...');

            // Wait a bit for any lazy-loaded content
            await page.waitForTimeout(3000);

            // Take another screenshot after waiting
            await page.screenshot({path: 'debug-after-wait.png', fullPage: true});

        } catch (error) {
            console.warn('Could not find product container, but will try to proceed anyway');
            // Save the page content for debugging
            const content = await page.content();
            fs.writeFileSync('debug-page.html', content);
            console.log('Saved debug-page.html with current page content');
        }

        console.log('Scrolling to load all products...');
        // Scroll to load all products
        await autoScroll(page);
        await page.waitForTimeout(2000); // Wait for any lazy-loaded content

        console.log('Extracting products...');

        // Take a screenshot before extraction for debugging
        await page.screenshot({path: 'debug-before-extract.png', fullPage: true});

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

        log(`Found ${products.length} products`);

        // Process products up to the limit for scraping, but keep all products in the output
        const numProductsToProcess = Math.min(products.length, maxProducts);
        const productsToProcess = products.slice(0, numProductsToProcess);
        log(`\nProcessing ${numProductsToProcess} products${maxProducts < products.length ? ` (limited from ${products.length})` : ''}`);

        // Helper function to extract EAN from product page
        async function extractEAN(page) {
            try {
                return await page.evaluate(() => {
                    // First try to find the EAN in the product details section
                    const details = Array.from(document.querySelectorAll('div, p, span, li, td'))
                        .find(el => el.textContent && el.textContent.includes('Réf / EAN :'));
                    
                    if (details) {
                        // Try to find the EAN in the text content
                        const eanMatch = details.textContent.match(/Réf \/ EAN :[^\d]*(\d{13})/);
                        if (eanMatch && eanMatch[1]) {
                            return eanMatch[1];
                        }
                        
                        // Alternative: Look for EAN in a sibling element
                        const nextSibling = details.nextElementSibling;
                        if (nextSibling) {
                            const siblingEan = nextSibling.textContent.trim();
                            if (/^\d{13}$/.test(siblingEan)) {
                                return siblingEan;
                            }
                        }
                    }
                    
                    // As a fallback, try to find any 13-digit number on the page
                    const allText = document.body.textContent;
                    const eanMatch = allText.match(/\b\d{13}\b/);
                    if (eanMatch) {
                        return eanMatch[0];
                    }
                    
                    return null;
                });
            } catch (error) {
                logError('Error extracting EAN:', error);
                return null;
            }
        }

        // Helper function to extract sucres with retries
        async function extractSucresWithRetry(page, maxRetries = 3, initialDelay = 2000) {
            let lastError;

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    return await page.evaluate(() => {
                        // Find the "Valeurs nutritionnelles" section
                        const nutritionSection = Array.from(document.querySelectorAll('h2, h3, h4, div, section'))
                            .find(el => el.textContent && el.textContent.toLowerCase().includes('valeurs nutritionnelles'));

                        if (nutritionSection) {
                            // Look for "Sucres" in the section (supports both 4.5 g and 4,5 g formats)
                            const sectionText = nutritionSection.textContent;
                            const sucresMatch = sectionText.match(/sucres?[^\d]*([\d]+[.,]?[\d]*)\s*[gG]/i);

                            if (sucresMatch && sucresMatch[1]) {
                                // Replace comma with dot and ensure proper number format
                                return sucresMatch[1].replace(',', '.');
                            }

                            // Alternative approach: look for table or list items
                            const sectionElement = nutritionSection.nextElementSibling ||
                                nutritionSection.parentElement;

                            if (sectionElement) {
                                const allText = sectionElement.textContent.toLowerCase();
                                const textMatch = allText.match(/sucres?[^\d]*([\d]+[.,]?[\d]*)\s*[gG]/i);
                                if (textMatch && textMatch[1]) {
                                    // Replace comma with dot and ensure proper number format
                                    return textMatch[1].replace(',', '.');
                                }
                            }
                        }
                        return null;
                    });
                } catch (error) {
                    lastError = error;
                    if (attempt < maxRetries) {
                        const delay = initialDelay * attempt;
                        log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
                        await page.waitForTimeout(delay);
                    }
                }
            }

            logError(`Failed to extract sucres after ${maxRetries} attempts:`, lastError?.message || 'Unknown error');
            return null;
        }

        // Process products in batches with concurrency
        const concurrency = 3; // Number of concurrent requests
        
        // Process products in chunks to limit concurrency
        for (let i = 0; i < productsToProcess.length; i += concurrency) {
            const chunk = productsToProcess.slice(i, i + concurrency);
            
            // Process current chunk in parallel
            await Promise.all(chunk.map(async (product, chunkIndex) => {
                const productNum = i + chunkIndex + 1;
                if (!product.url) return;
                
                // Create a new context and page for each concurrent request
                const context = await browser.newContext({
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    viewport: { width: 1920, height: 1080 },
                    locale: 'fr-FR',
                    timezoneId: 'Europe/Paris'
                });
                const page = await context.newPage();
                
                try {
                    log(`\n[${productNum}/${numProductsToProcess}] Extracting info for: ${product.brand} - ${product.description}`);
                    
                    // Navigate directly to the product page
                    await page.goto(product.url, { waitUntil: 'networkidle', timeout: 30000 });
                    
                    // Extract the EAN
                    const ean = await extractEAN(page);
                    if (ean) {
                        log(`[${productNum}] Found EAN: ${ean}`);
                        product.ean = ean;
                    }
                    
                    // Extract the "Sucres" value with retry mechanism
                    const sucresValue = await extractSucresWithRetry(page);
                    log(`[${productNum}] Sucres value: ${sucresValue}`);
                    
                    // Add the nutritional info to the product
                    if (sucresValue !== null) {
                        const sucresNumber = parseFloat(sucresValue);
                        product.nutritionalInfo = {
                            sucres: isNaN(sucresNumber) ? sucresValue : sucresNumber
                        };
                    }
                    
                    // Add a small delay between requests to be gentle on the server
                    await page.waitForTimeout(1000);
                    
                } catch (error) {
                    logError(`[${productNum}] Error processing product:`, error);
                } finally {
                    // Always close the page and context to free up resources
                    await page.close();
                    await context.close();
                }
            }));
            
            // Small delay between chunks to avoid overwhelming the server
            if (i + concurrency < productsToProcess.length) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Create logs directory if it doesn't exist and we're in verbose mode
        if (verbose) {
            if (!fs.existsSync('logs')) {
                fs.mkdirSync('logs');
            }
        }

        // Prepare data for Nunjucks template
        // Include all products in the output, not just the processed ones
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
                // Sort by sucres value, with null/undefined values at the end
                const aSucres = a.nutritionalInfo.sucres === null ? Infinity : a.nutritionalInfo.sucres;
                const bSucres = b.nutritionalInfo.sucres === null ? Infinity : b.nutritionalInfo.sucres;
                return aSucres - bSucres;
            });

        // Save to src/_data/beers.json
        const dataDir = path.join('src', '_data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, {recursive: true});
        }

        const beersJsonPath = path.join(dataDir, 'beers.json');
        fs.writeFileSync(beersJsonPath, JSON.stringify(beersData, null, 2));

        if (verbose) {
            log(`\nSaved ${beersData.length} beers to ${beersJsonPath}`);

            // Save a timestamped copy in logs if in verbose mode
            const logsDir = path.join('logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, {recursive: true});
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

// Run the function and handle any uncaught errors
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
