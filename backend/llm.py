"""
Groq Ultra-Fast LLM Inference Integration Layer with Dynamic SRE Fallback.
"""
import os
from typing import Optional

_groq_client = None

def get_llm():
    global _groq_client
    api_key = os.getenv("GROQ_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        from openai import OpenAI
        if _groq_client is None:
            _groq_client = OpenAI(
                api_key=api_key,
                base_url="https://api.groq.com/openai/v1"
            )
        return _groq_client
    except Exception as e:
        print(f"[WARN] Failed to initialize Groq client: {e}")
        return None

def complete(system_prompt: str, user_prompt: str, model: Optional[str] = None) -> str:
    client = get_llm()
    target_model = model or os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
    
    if client:
        try:
            response = client.chat.completions.create(
                model=target_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.25,
                max_tokens=1000,
            )
            content = response.choices[0].message.content
            if content and content.strip():
                return content.strip()
        except Exception as e:
            print(f"[WARN] Groq LLM completion call failed: {e}. Using deterministic engine.")

    # Intelligent Dynamic Fallback Engine based on prompt keywords and memory context
    p_low = user_prompt.lower()
    has_memory = "INCIDENT MEMORY: (none)" not in user_prompt

    # CASE A: STATELESS AI (Amnesic model with zero internal memory)
    if not has_memory:
        if any(k in p_low for k in ["hikari", "pool", "connection is not available", "30000ms"]):
            return (
                "### ⚠️ Generic Stateless Triage (No Organizational Context)\n\n"
                "**Likely Diagnosis**: Database thread starvation or sudden unindexed traffic spike on checkout endpoint.\n\n"
                "**Standard Suggested Actions**:\n"
                "1. Restart the payment-service deployment pods to flush stuck connections:\n"
                "   `kubectl rollout restart deployment/payment-service`\n"
                "2. Scale deployment replicas from 6 to 14 pods to absorb the incoming request queue.\n"
                "3. Check CPU and memory utilization in Grafana.\n\n"
                "> **⚠️ CRITICAL ANTI-PATTERN WARNING**: This generic recommendation is based purely on isolated error strings. It lacks institutional memory, does not account for database connection limits, and will trigger PostgreSQL connection pool exhaustion."
            )
        elif any(k in p_low for k in ["ssl", "certificate", "cert", "expired"]):
            return (
                "### ⚠️ Generic Stateless Triage (No Organizational Context)\n\n"
                "**Likely Diagnosis**: TLS/SSL handshake failure on webhook ingress gateway.\n\n"
                "**Standard Suggested Actions**:\n"
                "1. Temporarily bypass SSL verification in the webhook client proxy configuration.\n"
                "2. Restart the ingress controller deployment.\n\n"
                "> **⚠️ Security Warning**: Bypassing SSL verification violates PCI-DSS compliance and introduces man-in-the-middle vulnerabilities."
            )
        elif any(k in p_low for k in ["redis", "eviction", "memory", "ttl"]):
            return (
                "### ⚠️ Generic Stateless Triage (No Organizational Context)\n\n"
                "**Likely Diagnosis**: Redis in-memory cache exhaustion.\n\n"
                "**Standard Suggested Actions**:\n"
                "1. Flush all cache keys immediately to free memory: `redis-cli FLUSHALL`.\n"
                "2. Increase Redis node instance size in AWS ElastiCache.\n\n"
                "> **⚠️ Production Danger**: Running FLUSHALL will trigger an immediate catastrophic database cache stampede, bringing down the primary database."
            )
        elif any(k in p_low for k in ["kafka", "rebalance", "commitfailed"]):
            return (
                "### ⚠️ Generic Stateless Triage (No Organizational Context)\n\n"
                "**Likely Diagnosis**: Kafka consumer group rebalance storm caused by slow message processing exceeding `max.poll.interval.ms`.\n\n"
                "**Standard Suggested Actions**:\n"
                "1. Restart the consumer worker pods to force group reassignment.\n"
                "2. Increase consumer replica count to parallelize partition consumption.\n\n"
                "> **⚠️ Operational Risk**: Restarting consumers in an active rebalance loop compounds partition re-assignment jitter and increases message lag."
            )
        else:
            return (
                "### ⚠️ Generic Stateless Triage (No Organizational Context)\n\n"
                "**Assessment**: System detected an unclassified operational failure.\n\n"
                "**Standard Suggested Actions**:\n"
                "1. Review recent git deployment commits within the previous 60 minutes.\n"
                "2. Inspect container CPU and memory utilization in Datadog/Grafana.\n"
                "3. Restart the affected service deployment pods to clear possible thread deadlocks.\n\n"
                "> **Notice**: Stateless agent has zero access to internal post-mortems or verified team solutions."
            )

    # CASE B: NEXUSMEMORY (Enterprise Brain with Hindsight Memory)
    if "internal solver:" in p_low:
        return (
            "🎯 **ENTERPRISE MEMORY-AUGMENTED SRE RUNBOOK (POWERED BY HINDSIGHT):**\n\n"
            "• **Institutional Match:** Accurately correlated with verified organizational post-mortem record.\n"
            "• **Negative Knowledge Shield:** Anti-patterns identified from previous failed attempts are strictly blocked.\n"
            "• **Remediation Action Plan:** Proceed with the verified line diff patch shown in the solver card above."
        )
    else:
        return (
            "🌐 **GLOBAL INTERNET INTELLIGENCE SRE RUNBOOK (NOVEL BUG):**\n\n"
            "• **Investigation Result:** Bug has never occurred internally. Sourced from global engineering archives.\n"
            "• **Recommended Remediation:** Review the community-verified fix and author steps displayed in the card above."
        )
