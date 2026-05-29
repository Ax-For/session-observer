import { test, expect } from '@playwright/test';
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Dashboard Visual Test', () => {
  test('capture observability dashboard screenshot', async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 }
    });
    const page = await context.newPage();

    console.log('Navigating to http://127.0.0.1:8787...');
    await page.goto('http://127.0.0.1:8787', { waitUntil: 'networkidle' });

    // Wait for the page to load
    await page.waitForTimeout(2000);

    // Log the page title
    const pageTitle = await page.title();
    console.log(`Page title: ${pageTitle}`);

    // Take a screenshot of the initial page
    const initialScreenshotPath = path.join(__dirname, '..', '.runtime', 'dashboard-initial.png');
    await page.screenshot({ path: initialScreenshotPath, fullPage: true });
    console.log(`Initial screenshot saved to: ${initialScreenshotPath}`);

    // Try to find and click the Observability tab
    // Look for various possible tab selectors
    const possibleSelectors = [
      'text=观测',
      'text=Observability',
      'text=Dashboard',
      '[data-testid="observability-tab"]',
      '[data-testid="dashboard-tab"]',
      'button:has-text("观测")',
      'button:has-text("Observability")',
      'a:has-text("观测")',
      'a:has-text("Observability")',
      'tab:has-text("观测")',
      'tab:has-text("Observability")',
    ];

    let tabClicked = false;
    for (const selector of possibleSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          console.log(`Found element with selector: ${selector}`);
          await element.click();
          tabClicked = true;
          await page.waitForTimeout(1500);
          break;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    if (!tabClicked) {
      console.log('Could not find observability tab - page may already be on dashboard view');
    }

    // Take screenshot of the dashboard
    const screenshotPath = path.join(__dirname, '..', '.runtime', 'dashboard-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Dashboard screenshot saved to: ${screenshotPath}`);

    // Get the page content for analysis
    const pageContent = await page.content();

    // Look for key dashboard elements
    console.log('\n--- Page Structure Analysis ---');

    // Check for stat cards with numbers
    const statCards = await page.$$('[class*="stat"], [class*="Stat"], [class*="card"], [class*="Card"]');
    console.log(`Found ${statCards.length} potential stat cards`);

    // Check for charts
    const areaCharts = await page.$$('[class*="area"], [class*="Area"], [class*="chart"], [class*="Chart"]');
    console.log(`Found ${areaCharts.length} potential chart elements`);

    const donutCharts = await page.$$('[class*="donut"], [class*="Donut"], [class*="pie"], [class*="Pie"]');
    console.log(`Found ${donutCharts.length} potential donut/pie chart elements`);

    // Get all text content to understand what's on the page
    const bodyText = await page.textContent('body');
    console.log('\n--- Visible Text Content (first 2000 chars) ---');
    console.log(bodyText.substring(0, 2000));

    // Look for panel titles
    const headings = await page.$$('h1, h2, h3, [class*="Title"], [class*="title"]');
    console.log(`\n--- Found ${headings.length} headings/titles ---`);

    for (let i = 0; i < Math.min(headings.length, 20); i++) {
      const heading = headings[i];
      const text = await heading.textContent();
      console.log(`  - ${text?.trim()}`);
    }

    // Check for SVG elements (charts usually use SVG)
    const svgs = await page.$$('svg');
    console.log(`\n--- Found ${svgs.length} SVG elements (likely charts) ---`);

    // Look for numbers in the page (stat values)
    const numberPattern = /\b\d{1,3}(,\d{3})*\b/g;
    const numbers = bodyText.match(numberPattern);
    if (numbers) {
      console.log(`\n--- Numbers found on page (sample): ---`);
      console.log(numbers.slice(0, 20).join(', '));
    }

    // Final assertions
    expect(pageContent).toBeTruthy();

    // Check if we have some meaningful content
    const hasContent = bodyText.length > 100;
    expect(hasContent).toBeTruthy();

    await browser.close();

    console.log('\n--- Test Summary ---');
    console.log(`Initial screenshot: ${initialScreenshotPath}`);
    console.log(`Dashboard screenshot: ${screenshotPath}`);
    console.log(`Page title: ${pageTitle}`);
    console.log(`Tab clicked: ${tabClicked}`);
    console.log(`Content length: ${bodyText.length} characters`);
  });
});