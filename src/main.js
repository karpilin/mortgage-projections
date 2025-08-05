import Chart from 'chart.js/auto';

// --- DOM Elements ---
const principalInput = document.getElementById('principal');
const termInput = document.getElementById('term');
const paymentAmountInput = document.getElementById('paymentAmount');
const interestRatePeriodsDiv = document.getElementById('interestRatePeriods');
const addRateBtn = document.getElementById('addRateBtn');

const payoffTimeEl = document.getElementById('payoffTime');
const totalInterestEl = document.getElementById('totalInterest');
const initialMinPaymentEl = document.getElementById('initialMinPayment');
const totalOverpaymentsEl = document.getElementById('totalOverpayments');
const errorMessageEl = document.getElementById('error-message');
const infoMessageEl = document.getElementById('info-message');

let payoffChart = null;

// --- Core Logic ---

/**
 * Calculates the standard monthly mortgage payment.
 * @param {number} principal - The loan principal.
 * @param {number} monthlyInterestRate - The monthly interest rate.
 * @param {number} numberOfMonths - The total number of months for the loan.
 * @returns {number} The calculated monthly payment.
 */
function calculateMinimumPayment(principal, monthlyInterestRate, numberOfMonths) {
    if (principal <= 0) return 0;
    if (monthlyInterestRate <= 0) return principal / numberOfMonths;
    if (numberOfMonths <= 0) return principal;
    const factor = Math.pow(1 + monthlyInterestRate, numberOfMonths);
    if (!isFinite(factor)) return principal; // Handle huge numbers
    return principal * (monthlyInterestRate * factor) / (factor - 1);
}

/**
 * Main function to run the simulation.
 */
function runSimulation() {
    errorMessageEl.classList.add('hidden');
    infoMessageEl.classList.add('hidden');

    // --- Get Inputs ---
    const principal = parseFloat(principalInput.value);
    const termYears = parseInt(termInput.value);
    const paymentAmount = parseFloat(paymentAmountInput.value) || 0;
    const rateInputs = Array.from(document.querySelectorAll('.rate-input'));
    const interestRates = rateInputs.map(input => parseFloat(input.value) / 100);

    // --- Validate Inputs ---
    if (isNaN(principal) || principal <= 0) { showError("Invalid principal amount."); return; }
    if (isNaN(termYears) || termYears <= 0) { showError("Invalid term."); return; }
    if (isNaN(paymentAmount) || paymentAmount <= 0) { showError("Invalid payment amount."); return; }
    if (interestRates.some(isNaN)) { showError("Please fill in all interest rate fields."); return; }
    if (interestRates.length === 0) { showError("Please add at least one interest rate period."); return; }

    // --- Simulation Setup ---
    let balance = principal;
    let totalInterestPaid = 0;
    let totalOverpaymentsMade = 0;
    let months = 0;
    const totalMonthsInTerm = termYears * 12;
    const interestGraphData = [];
    const paymentGraphData = [];
    const principalGraphData = [];

    let annualOverpaymentCap = 0;
    let overpaymentsThisYear = 0;
    let capHasBeenHit = false;

    // --- Calculate Benchmark Initial Payment ---
    const initialMonthlyRate = interestRates[0] / 12;
    const initialMinPayment = calculateMinimumPayment(principal, initialMonthlyRate, totalMonthsInTerm);
    principalGraphData.push({ x: 0, y: principal });

    // --- Simulation Loop ---
    while (balance > 0 && months < totalMonthsInTerm) {
        // Set annual cap at the start of each year
        if (months % 12 === 0) {
            annualOverpaymentCap = balance * 0.10;
            overpaymentsThisYear = 0;
        }

        const currentPeriodIndex = Math.floor(months / 24);
        const annualInterestRate = interestRates[Math.min(currentPeriodIndex, interestRates.length - 1)];
        const monthlyInterestRate = annualInterestRate / 12;

        const interestForMonth = balance * monthlyInterestRate;

        const remainingMonthsInTerm = totalMonthsInTerm - months;
        const minimumMonthlyPayment = calculateMinimumPayment(balance, monthlyInterestRate, remainingMonthsInTerm);

        // Determine the overpayment amount and apply the cap
        let intendedOverpayment = Math.max(0, paymentAmount - minimumMonthlyPayment);
        let allowedOverpayment = Math.max(0, annualOverpaymentCap - overpaymentsThisYear);
        let actualOverpayment = Math.min(intendedOverpayment, allowedOverpayment);

        if (intendedOverpayment > actualOverpayment) {
            capHasBeenHit = true;
        }

        const finalPaymentThisMonth = minimumMonthlyPayment + actualOverpayment;

        if (finalPaymentThisMonth < interestForMonth && balance > 0) {
            showError(`Payment of £${finalPaymentThisMonth.toFixed(2)} is not enough to cover interest of £${interestForMonth.toFixed(2)} in month ${months+1}.`);
            resetResults({initialMinPayment});
            return;
        }

        const principalPaid = finalPaymentThisMonth - interestForMonth;

        balance -= principalPaid;
        totalInterestPaid += interestForMonth;
        overpaymentsThisYear += actualOverpayment;
        totalOverpaymentsMade += actualOverpayment;
        months++;

        // Add data for graphs after month has passed
        const yearX = months / 12;
        interestGraphData.push({ x: yearX, y: interestForMonth });
        paymentGraphData.push({ x: yearX, y: finalPaymentThisMonth });
        principalGraphData.push({ x: yearX, y: Math.max(0, balance) });
    }

    if (capHasBeenHit) {
        showInfo("Your 10% annual overpayment cap was reached in one or more years. Payments were automatically reduced to stay within the limit.");
    }

    updateUI(months, totalInterestPaid, initialMinPayment, totalOverpaymentsMade, interestGraphData, paymentGraphData, principalGraphData);
}

// --- UI Update Functions ---

function updateUI(months, totalInterest, initialMinPayment, totalOverpayments, interestData, paymentData, principalData) {
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    payoffTimeEl.textContent = `${years} years, ${remainingMonths} months`;
    totalInterestEl.textContent = totalInterest.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
    initialMinPaymentEl.textContent = initialMinPayment.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
    totalOverpaymentsEl.textContent = totalOverpayments.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

    payoffChart.data.labels = principalData.map(p => p.x);
    payoffChart.data.datasets[0].data = interestData;
    payoffChart.data.datasets[1].data = paymentData;
    payoffChart.data.datasets[2].data = principalData;
    payoffChart.update();
}

function showError(message) {
    errorMessageEl.textContent = message;
    errorMessageEl.classList.remove('hidden');
}

function showInfo(message) {
    infoMessageEl.textContent = message;
    infoMessageEl.classList.remove('hidden');
}

function resetResults(defaults = {}) {
    payoffTimeEl.textContent = '-';
    totalInterestEl.textContent = '-';
    initialMinPaymentEl.textContent = defaults.initialMinPayment ? defaults.initialMinPayment.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' }) : '-';
    totalOverpaymentsEl.textContent = '-';
    if(payoffChart) {
        payoffChart.data.labels = [];
        payoffChart.data.datasets[0].data = [];
        payoffChart.data.datasets[1].data = [];
        payoffChart.data.datasets[2].data = [];
        payoffChart.update();
    }
}

// --- Dynamic Rate Period Management ---

function addRatePeriod(rateValue = '') {
    const periodIndex = interestRatePeriodsDiv.children.length;
    const startYear = periodIndex * 2;
    const endYear = startYear + 2;

    const periodDiv = document.createElement('div');
    periodDiv.className = 'flex items-center gap-2 mb-2';
    periodDiv.innerHTML = `
        <label for="rate-${periodIndex}" class="text-sm font-medium text-gray-600 w-2/5">Years ${startYear}-${endYear}</label>
        <div class="relative w-3/5">
            <input type="number" id="rate-${periodIndex}" value="${rateValue}" step="0.01" class="rate-input w-full pr-10 px-4 py-1 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="e.g., 5.5">
            <span class="absolute right-0 top-0 h-full pr-4 flex items-center text-gray-400">%</span>
        </div>
    `;
    interestRatePeriodsDiv.appendChild(periodDiv);
    periodDiv.querySelector('input').addEventListener('input', runSimulation);
}

// --- Chart Initialization ---
function createChart() {
    const ctx = document.getElementById('payoffChart').getContext('2d');
    payoffChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Monthly Interest',
                data: [],
                borderColor: 'rgba(220, 38, 38, 1)', // red-600
                borderWidth: 2,
                fill: false,
                pointRadius: 0,
                tension: 0.1,
                yAxisID: 'y'
            },
                {
                    label: 'Actual Payment',
                    data: [],
                    borderColor: 'rgba(79, 70, 229, 1)', // indigo-600
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
                },
                {
                    label: 'Remaining Principal',
                    data: [],
                    backgroundColor: 'rgba(16, 185, 129, 0.2)', // green-400
                    borderColor: 'rgba(5, 150, 105, 1)', // green-600
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y1'
                }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { // Left axis for monthly amounts
                    beginAtZero: true,
                    position: 'left',
                    ticks: { callback: value => '£' + value.toLocaleString('en-GB') },
                    title: { display: true, text: 'Monthly Amount' }
                },
                y1: { // Right axis for principal balance
                    beginAtZero: true,
                    position: 'right',
                    grid: {
                        drawOnChartArea: false, // Only show grid lines for the left axis
                    },
                    ticks: { callback: value => '£' + (value/1000).toFixed(0) + 'k' },
                    title: { display: true, text: 'Remaining Principal' }
                },
                x: {
                    title: { display: true, text: 'Years' },
                    ticks: {
                        stepSize: 0.5,
                        callback: function(value, index, ticks) {
                            const label = this.getLabelForValue(value);
                            // Check if the label is a multiple of 0.5 with a small tolerance for floating point inaccuracies
                            if (Math.abs(label % 0.5) < 0.001 || Math.abs((label % 0.5) - 0.5) < 0.001) {
                                return label.toFixed(1);
                            }
                            return ''; // Return an empty string for all other ticks to hide them
                        }
                    }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(context.parsed.y);
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    createChart();
    // Add initial rate periods with new defaults
    addRatePeriod(4.64);
    addRatePeriod(4.29);
    addRatePeriod(3.94);
    runSimulation();
});

addRateBtn.addEventListener('click', () => addRatePeriod());
[principalInput, termInput, paymentAmountInput].forEach(input => {
    input.addEventListener('input', runSimulation);
});