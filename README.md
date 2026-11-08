# NexusMemory Enterprise // Multi-Page Autonomous SRE Operating System

[![Hindsight Memory](https://img.shields.io/badge/Memory-Hindsight%20Cloud-4f46e5.svg)](https://github.com/vectorize-io/hindsight)
[![Groq Inference](https://img.shields.io/badge/Inference-Groq%20OSS--120B-10b981.svg)](https://groq.com/)
[![FastAPI](https://img.shields.io/badge/Backend-FastAPI%200.115-3b82f6.svg)](https://fastapi.tiangolo.com/)
[![Next.js](https://img.shields.io/badge/Frontend-Next.js%2014-white.svg)](https://nextjs.org/)

A professional, enterprise-grade multi-page SRE and developer incident platform with physical in-office presence verification, Swiss/Linear FinTech aesthetics, and persistent memory powered by [Hindsight](https://github.com/vectorize-io/hindsight) and [Groq](https://groq.com/).

---

## Multi-Page Route Structure

1. **`/`** - **Public Enterprise Landing & Hero Intro**:
   - Executive value proposition, -64% MTTR benchmarks, 98.6% confidence rating.
   - Separate action paths for Employee Badge Registration and Corporate SSO Login.
2. **`/register`** - **In-Office Presence Verification & Badge Issuance**:
   - Physical campus geofence checking (Hyderabad HITEC City Campus 4 / Bengaluru Electronic City).
   - Corporate Wi-Fi SSID and corporate IP validation.
   - Role, department, and employee ID badge registration.
3. **`/login`** - **Corporate SSO & Credentials Portal**:
   - Single sign-on with quick demo profiles for judges (`Manikanta S. • EMP-1042`, `Priya Nair • EMP-0883`, `Guest Developer`).
4. **`/console`** - **Modular SRE Command Console**:
   - Refined slate & zinc design system with persistent sidebar.
   - 7 distinct operational modules: Triage, What-If Lab, Knowledge Vault, Workspaces, Systemic Risk, Ingestion, and Auto-Heals.

---

## Quickstart

### Backend Setup (Terminal 1)
```bash
cd backend
python -m venv .venv
.\.venv\Scripts\activate   # Windows (.venv/bin/activate on Mac/Linux)
pip install -r requirements.txt
Copy-Item .env.example .env
python run.py
```
*Backend runs on `http://localhost:8000`.*

### Frontend Setup (Terminal 2)
```bash
cd frontend
npm install
npm run dev
```
*App runs on `http://localhost:3000`.*
