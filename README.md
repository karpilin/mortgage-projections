# **Advanced Mortgage Overpayment Simulator**

This is a web-based mortgage simulator designed to provide detailed projections for a UK-style mortgage. It allows users to see the long-term effects of fixed monthly payments and annual overpayment caps against a schedule of changing interest rates.

Its specific aim is to highlight the benefits of **reducing the contractual payment** rather than the term when overpaying: total interest is slightly higher, but the minimum obligation falls over time — giving flexibility if income or interest rates change — while the freedom to overpay (and to repay in full at the end of any fixed period) is unchanged. That flexibility makes it practical to shift household borrowing such as car loans or credit cards under the mortgage umbrella at the lowest overall interest rate.

The application is built with modern web technologies, including Vite for a fast development environment, and is bundled into a single, portable HTML file for easy distribution and offline use.

## **Features**

* **Dynamic Interest Rates:** Define a schedule of successive fixed periods, each with its own length in months, interest rate, and product fee. Fees are added to the loan at the start of their fix; the last line's terms carry forward, fee-free, until payoff.
* **Fixed Monthly Payments:** Set a consistent monthly payment amount and see how it impacts the loan payoff time.
* **10% Overpayment Cap:** The simulator accurately models a common mortgage feature where annual overpayments are capped at 10% of the remaining principal at the start of the year.
* **Term vs Payment Reduction:** Choose whether overpayments shorten the mortgage term (the contractual payment level is kept at each rate change) or reduce the contractual payment (the original end date is kept).
* **Planned Full Repayment:** Model clearing the whole remaining balance at the end of any fixed period — no early repayment charge applies there, so the lump sum is not subject to the 10% cap.
* **Debt Consolidation Comparison:** See what shifting a car loan or credit-card balance under the mortgage umbrella saves versus keeping it standalone. The comparison matches monthly outgoings: the standalone loan's payment is redirected into the mortgage for the months the loan would have run.
* **Detailed Summary:** Get a quick overview of the key metrics, including the actual payoff time, total interest paid, and total overpayments made.
* **Multi-Axis Graph:** Visualize your mortgage journey with a detailed graph showing:
    * Monthly Interest Paid (Left Axis)
    * Actual Monthly Payment Amount (Left Axis)
    * Remaining Principal Balance (Right Axis)
* **Portable Single-File Build:** The project can be compiled into a single, self-contained index.html file that runs in any modern browser without needing a web server.

## **Getting Started**

Follow these instructions to get a copy of the project up and running on your local machine for development and testing.

### **Prerequisites**

You need to have [Node.js](https://nodejs.org/) and npm (which comes with Node.js) installed on your system.

### **Installation**

1. Clone the repository (or set up the files):  
   If you have the project files, ensure they are in a directory. If not, you would typically clone it:  
   `git clone https://github.com/karpilin/mortgage-projections`
   `cd mortgage-simulator`

2. Install NPM packages:  
   This command will install all the necessary dependencies listed in package.json, including Vite, Tailwind CSS, and Chart.js.  
   `npm install`

## **Usage**

The project includes several npm scripts to handle development and building.

### **Development Server**

To run the application in a live-reloading development mode, use:

`npm run dev`

This will start a local server (usually at http://localhost:5173) and automatically open the application in your browser. The server will watch for changes to your files and update the browser instantly.

### **Building the Single HTML File**

To generate the final, portable index.html file, run the build command:

`npm run build`

This will create a dist folder. Inside this folder, you will find the index.html file. This file is completely self-contained with all CSS and JavaScript inlined, and you can open it directly in any web browser without needing a server.

### **Running the Tests**

The simulation logic is covered by a Vitest suite:

`npm test`

### **Previewing the Production Build**

If you want to test the production build on a local server before deploying, you can run:

`npm run preview`

This will serve the dist folder on a local port, which is useful for a final check.