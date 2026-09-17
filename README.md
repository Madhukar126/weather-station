# Weather Station — MausamGuard

[![Deploy to GitHub Pages](https://github.com/Madhukar126/weather-station/actions/workflows/deploy.yml/badge.svg)](https://github.com/Madhukar126/weather-station/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![React](https://img.shields.io/badge/React-19-61dafb.svg?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6.svg?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg?logo=vite)](https://vitejs.dev/)

An intelligent, browser-local weather station observation, monitoring, and sensor anomaly detection suite. Built with **React**, **TypeScript**, **Vite**, **Recharts**, and **Tailwind CSS**. All algorithms and models run client-side in the browser—no backend server, Python service, or API keys required.

🔗 **Live Demo:** [https://Madhukar126.github.io/weather-station/](https://Madhukar126.github.io/weather-station/)

---

## Key Features

- **Real-Time Sensor Monitoring:** Live visualization of temperature, humidity, atmospheric pressure, calculated dew point, and heat index.
- **Client-Side Anomaly Detectors:**
  - **MausamGuard Harmonic Model:** Ridge harmonic regression capturing diurnal atmospheric patterns, standardized residuals, and trailing window means.
  - **Isolation Forest:** Deterministic multi-tree ensemble isolating outliers using measurement values, first differences, and rolling variability.
  - **Conventional QC Rules:** Range boundaries, rate-of-change limits, flatline/stuck sensor checks, null imputation, and timestamp cadence verification.
- **Fault Injection & Scenario Simulation:** Test resilience against sensor spikes, calibration drift, flatlines, dropouts, and synthetic extreme weather events.
- **Model Evaluation & Comparison:** Benchmark recall, mean detection delay, false-alert rates, and exposure intervals across different algorithms.
- **Data Workspace:** Upload custom station CSV files (120–5,000 observations), preview data, and export comprehensive diagnostic JSON reports.

---

## Quick Start

### Prerequisites
- Node.js 22.13 or newer
- npm or pnpm

### Installation & Local Run

```bash
# Clone the repository
git clone https://github.com/Madhukar126/weather-station.git

# Enter the project directory
cd weather-station

# Install dependencies
npm install

# Start the local development server
npm run dev
```

Open [http://localhost:5180](http://localhost:5180) in your browser.

### Run Tests & Build

```bash
# Run unit tests for detection and calculation engine
npm test

# Build optimized static distribution for production
npm run build

# Preview the production build locally
npm run start
```

---

## Deployment

### GitHub Pages (Automated CI/CD)
A GitHub Actions workflow is provided in [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Every push to `main` automatically runs the test suite, builds the static bundle, and deploys to GitHub Pages.

To enable GitHub Pages in your repository:
1. Navigate to **Settings** > **Pages** on your repository [Madhukar126/weather-station](https://github.com/Madhukar126/weather-station).
2. Under **Build and deployment** > **Source**, select **GitHub Actions**.

### Vercel
Deploy seamlessly with Vercel using the pre-configured [`vercel.json`](vercel.json):
```bash
npx vercel
```

---

## Data Contract

One station per CSV; 120–5,000 rows, ≤5 MB.

| Column | Format / Unit | Description |
|---|---|---|
| `timestamp` | ISO-8601 with timezone | Must be strictly increasing and unique |
| `temperature` | °C | Ambient air temperature |
| `pressure` | hPa | Station atmospheric pressure |
| `humidity` | % | Relative humidity (0–100%) |
| `label` | String *(optional)* | `normal`, `weather`, `spike`, `drift`, `stuck`, `dropout`, `unknown` |

Missing measurements can be represented by empty cells, `null`, or `-9999`.

---

## Reference & Sources

- [SIH Problem Statement 26073](https://sih.gov.in/sih2026PS#ViewProblemStatement26073)
- [NOAA MADIS Surface QC Notes](https://madis.ncep.noaa.gov/madis_sfc_qc_notes.shtml)
- [Max Planck Institute Jena Weather Data Benchmark](https://www.bgc-jena.mpg.de/wetter/weather_data.html)

---

## License

This project is open source and available under the [MIT License](LICENSE).
