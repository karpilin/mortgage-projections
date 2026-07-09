import Chart from 'chart.js/auto';
import './style.css';
import { simulate } from './simulation.js';

// --- DOM Elements ---
const principalInput = document.getElementById('principal');
const termInput = document.getElementById('term');
const paymentAmountInput = document.getElementById('paymentAmount');
const fixYearsInput = document.getElementById('fixYears');
const fullRepaymentSelect = document.getElementById('fullRepayment');
const interestRatePeriodsDiv = document.getElementById('interestRatePeriods');
const addRateBtn = document.getElementById('addRateBtn');

const payoffTimeEl = document.getElementById('payoffTime');
const totalInterestEl = document.getElementById('totalInterest');
const initialContractualPaymentEl = document.getElementById('initialContractualPayment');
const totalOverpaymentsEl = document.getElementById('totalOverpayments');
const errorMessageEl = document.getElementById('error-message');
const infoMessageEl = document.getElementById('info-message');
const modeComparisonEl = document.getElementById('mode-comparison');

let payoffChart = null;

const gbp = value => value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const gbpWhole = value => value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const formatPayoff = months => `${Math.floor(months / 12)} years, ${months % 12} months`;

function currentFixYears() {
    const value = parseInt(fixYearsInput.value);
    return isNaN(value) || value < 1 ? 2 : value;
}

// Contractual payment in force during the loan's final fixed period
function finalPeriodContractual(result, fixMonths) {
    return result.schedule[Math.floor((result.months - 1) / fixMonths) * fixMonths].contractual;
}

let repaymentOptionsKey = null;

// Offer every fix boundary within the current term, keeping the
// user's selection when it's still valid.
function syncFullRepaymentOptions(termYears, fixYears) {
    const key = `${termYears}:${fixYears}`;
    if (repaymentOptionsKey === key) return;
    repaymentOptionsKey = key;
    const previous = fullRepaymentSelect.value;
    fullRepaymentSelect.innerHTML = '<option value="">No — run to payoff</option>';
    for (let year = fixYears; year < termYears; year += fixYears) {
        const option = document.createElement('option');
        option.value = String(year * 12);
        option.textContent = `End of year ${year}`;
        fullRepaymentSelect.appendChild(option);
    }
    if (Array.from(fullRepaymentSelect.options).some(o => o.value === previous)) {
        fullRepaymentSelect.value = previous;
    }
}

// --- Simulation ---

function runSimulation() {
    errorMessageEl.classList.add('hidden');
    infoMessageEl.classList.add('hidden');

    // --- Get Inputs ---
    const principal = parseFloat(principalInput.value);
    const termYears = parseInt(termInput.value);
    const paymentAmount = parseFloat(paymentAmountInput.value) || 0;
    const rateInputs = Array.from(document.querySelectorAll('.rate-input'));
    const interestRates = rateInputs.map(input => parseFloat(input.value) / 100);
    const overpaymentMode = document.querySelector('input[name="overpaymentMode"]:checked').value;
    const fixYears = parseInt(fixYearsInput.value);

    // --- Validate Inputs ---
    if (isNaN(principal) || principal <= 0) { showError("Invalid principal amount."); return; }
    if (isNaN(termYears) || termYears <= 0) { showError("Invalid term."); return; }
    if (isNaN(paymentAmount) || paymentAmount <= 0) { showError("Invalid payment amount."); return; }
    if (isNaN(fixYears) || fixYears < 1) { showError("Invalid fixed period length."); return; }
    if (interestRates.some(isNaN)) { showError("Please fill in all interest rate fields."); return; }
    if (interestRates.length === 0) { showError("Please add at least one interest rate period."); return; }

    syncFullRepaymentOptions(termYears, fixYears);
    const fullRepaymentMonth = fullRepaymentSelect.value === '' ? null : parseInt(fullRepaymentSelect.value);

    const inputs = { principal, termYears, paymentAmount, annualRates: interestRates, fullRepaymentMonth, fixYears };
    const reducePayment = simulate({ ...inputs, overpaymentMode: 'reducePayment' });
    const reduceTerm = simulate({ ...inputs, overpaymentMode: 'reduceTerm' });
    const result = overpaymentMode === 'reducePayment' ? reducePayment : reduceTerm;

    updateModeComparison(overpaymentMode, reducePayment, reduceTerm, fixYears * 12);

    const infos = [];
    if (result.fullRepayment) {
        infos.push(`The remaining balance of ${gbp(result.fullRepayment.amount)} is repaid in full at the end of year ${result.fullRepayment.month / 12} — the end of a fixed period, so no early repayment charge applies.`);
    }
    if (result.paymentBelowContractual) {
        infos.push("Your payment is below the contractual monthly payment in one or more months; the contractual payment was paid instead.");
    }
    if (result.capHit) {
        infos.push("Your 10% annual overpayment cap was reached in one or more years. Payments were automatically reduced to stay within the limit.");
    }
    if (infos.length > 0) showInfo(infos.join(' '));

    // A null anchor at x=0 keeps every dataset index-aligned with the
    // principal series (which starts at the full principal), so the
    // tooltip's index mode shows the same month across all lines.
    const interestGraphData = [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row.interest }))];
    const paymentGraphData = [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row.payment }))];
    const contractualGraphData = [{ x: 0, y: null }, ...result.schedule.map(row => ({ x: row.month / 12, y: row.contractual }))];
    const principalGraphData = [
        { x: 0, y: principal },
        ...result.schedule.map(row => ({ x: row.month / 12, y: Math.max(0, row.balance) })),
    ];
    if (result.fullRepayment) {
        principalGraphData.push({ x: result.fullRepayment.month / 12, y: 0 });
    }

    updateUI(result, interestGraphData, paymentGraphData, principalGraphData, contractualGraphData);
}

// --- UI Update Functions ---

function updateModeComparison(activeMode, reducePayment, reduceTerm, fixMonths) {
    const extraInterest = reducePayment.totalInterest - reduceTerm.totalInterest;
    const gap = gbpWhole(Math.abs(extraInterest));
    const similarCost = Math.abs(extraInterest) < 1;
    const lowMinimum = gbpWhole(finalPeriodContractual(reducePayment, fixMonths));
    const highMinimum = gbpWhole(finalPeriodContractual(reduceTerm, fixMonths));

    if (activeMode === 'reducePayment') {
        const cost = similarCost
            ? 'costs about the same in interest as'
            : `costs ${gap} ${extraInterest >= 0 ? 'more' : 'less'} in interest than`;
        modeComparisonEl.textContent = `Reducing the payment ${cost} reducing the term (which would pay off in ${formatPayoff(reduceTerm.months)}), but the contractual minimum falls to ${lowMinimum}/month by the final fixed period instead of staying around ${highMinimum} — the same overpayment freedom, with a far smaller obligation if income or rates change.`;
    } else {
        const saving = similarCost
            ? 'about the same total interest'
            : extraInterest >= 0 ? `${gap} less interest` : `${gap} more interest`;
        modeComparisonEl.textContent = `Reducing the term pays off in ${formatPayoff(reduceTerm.months)} with ${saving} than reducing the payment, but the contractual minimum stays around ${highMinimum}/month for the life of the loan; reducing the payment would let it fall to ${lowMinimum}/month with the same overpayment freedom.`;
    }
    modeComparisonEl.classList.remove('hidden');
}

function updateUI(result, interestData, paymentData, principalData, contractualData) {
    payoffTimeEl.textContent = formatPayoff(result.months);
    totalInterestEl.textContent = gbp(result.totalInterest);
    initialContractualPaymentEl.textContent = gbp(result.initialContractualPayment);
    totalOverpaymentsEl.textContent = gbp(result.totalOverpayments);

    payoffChart.data.datasets[0].data = interestData;
    payoffChart.data.datasets[1].data = paymentData;
    payoffChart.data.datasets[2].data = principalData;
    payoffChart.data.datasets[3].data = contractualData;
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

// --- Dynamic Rate Period Management ---

function addRatePeriod(rateValue = '') {
    const periodDiv = document.createElement('div');
    periodDiv.className = 'flex items-center gap-2 mb-2';
    periodDiv.innerHTML = `
        <label class="text-sm font-medium text-gray-600 w-2/5"></label>
        <div class="relative flex-1">
            <input type="number" value="${rateValue}" step="0.01" class="rate-input w-full pr-10 px-4 py-1 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="e.g., 5.5">
            <span class="absolute right-0 top-0 h-full pr-4 flex items-center text-gray-400">%</span>
        </div>
        <button type="button" class="remove-rate text-gray-400 hover:text-red-500 text-xl leading-none px-1" title="Remove this rate period" aria-label="Remove this rate period">&times;</button>
    `;
    interestRatePeriodsDiv.appendChild(periodDiv);
    periodDiv.querySelector('input').addEventListener('input', runSimulation);
    periodDiv.querySelector('.remove-rate').addEventListener('click', () => {
        periodDiv.remove();
        relabelRatePeriods();
        runSimulation();
    });
    relabelRatePeriods();
}

// Keep "Years X-Y" labels and rate-N ids consistent with row order and
// the current fixed-period length.
function relabelRatePeriods() {
    const fixYears = currentFixYears();
    Array.from(interestRatePeriodsDiv.children).forEach((row, index) => {
        const label = row.querySelector('label');
        const input = row.querySelector('input');
        input.id = `rate-${index}`;
        label.htmlFor = `rate-${index}`;
        label.textContent = `Years ${index * fixYears}-${(index + 1) * fixYears}`;
    });
}

// --- Chart Initialization ---
function createChart() {
    const ctx = document.getElementById('payoffChart').getContext('2d');
    payoffChart = new Chart(ctx, {
        type: 'line',
        data: {
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
                },
                {
                    label: 'Contractual Minimum',
                    data: [],
                    borderColor: 'rgba(100, 116, 139, 1)', // slate-500
                    borderDash: [6, 4],
                    borderWidth: 2,
                    fill: false,
                    pointRadius: 0,
                    tension: 0.1,
                    yAxisID: 'y'
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
                    type: 'linear',
                    min: 0,
                    title: { display: true, text: 'Years' }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    filter: item => item.parsed.y !== null,
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
document.querySelectorAll('input[name="overpaymentMode"]').forEach(radio => {
    radio.addEventListener('change', runSimulation);
});
fullRepaymentSelect.addEventListener('change', runSimulation);
fixYearsInput.addEventListener('input', () => {
    relabelRatePeriods();
    runSimulation();
});
