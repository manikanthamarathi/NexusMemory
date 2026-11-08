"""
Persistent SQLite Database Engine for NexusMemory Enterprise.
Stores real employee records, OTP codes, audit logs, and verified incident post-mortems.
"""
import sqlite3
import os
import math
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

DB_FILE = os.path.join(os.path.dirname(__file__), "nexus_enterprise.db")

CAMPUSES = [
    {"id": "HYD-CAMPUS-01", "name": "Hyderabad HITEC City Innovation Park", "lat": 17.4474, "lon": 78.3762, "max_radius_km": 5.0},
    {"id": "BLR-CAMPUS-02", "name": "Bengaluru Electronic City Tech Park", "lat": 12.8452, "lon": 77.6602, "max_radius_km": 5.0},
    {"id": "SF-HQ-03", "name": "San Francisco Global Tech Center", "lat": 37.7749, "lon": -122.4194, "max_radius_km": 3.0}
]

def calculate_haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates distance between two GPS coordinates in kilometers."""
    R = 6371.0 # Earth's radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

def get_connection():
    conn = sqlite3.connect(DB_FILE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_database():
    conn = get_connection()
    c = conn.cursor()
    
    # 1. Employees Table
    c.execute("""
    CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL,
        avatar TEXT,
        office_verified INTEGER DEFAULT 0,
        verified_campus TEXT,
        verified_distance_km REAL,
        network_zone TEXT,
        current_project_id TEXT,
        solved_count INTEGER DEFAULT 0,
        reputation_score REAL DEFAULT 5.0,
        registered_at TEXT
    )
    """)

    # 2. OTP Verification Table
    c.execute("""
    CREATE TABLE IF NOT EXISTS email_otps (
        email TEXT PRIMARY KEY,
        otp_code TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        verified INTEGER DEFAULT 0
    )
    """)

    # 3. Workspaces & Client Projects
    c.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        client TEXT NOT NULL,
        environment TEXT NOT NULL,
        sla TEXT NOT NULL,
        lead_emp_id TEXT,
        active_services TEXT
    )
    """)

    # 4. Institutional Solutions Table
    c.execute("""
    CREATE TABLE IF NOT EXISTS incident_solutions (
        id TEXT PRIMARY KEY,
        incident_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        service TEXT NOT NULL,
        resolved_by_id TEXT NOT NULL,
        symptoms TEXT NOT NULL,
        root_cause TEXT NOT NULL,
        failed_attempts TEXT NOT NULL,
        exact_fix TEXT NOT NULL,
        file_path TEXT NOT NULL,
        exact_line INTEGER NOT NULL,
        code_diff TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        occurrence_count INTEGER DEFAULT 1,
        user_rating REAL DEFAULT 5.0,
        external_docs_link TEXT
    )
    """)

    # 5. Audit & Escalation Log
    c.execute("""
    CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        actor TEXT NOT NULL,
        details TEXT NOT NULL
    )
    """)

    conn.commit()

    # Pre-seed verified enterprise leaders if empty
    c.execute("SELECT count(*) FROM employees")
    if c.fetchone()[0] == 0:
        c.execute("""
        INSERT INTO employees (id, name, email, role, department, avatar, office_verified, verified_campus, verified_distance_km, network_zone, current_project_id, solved_count, reputation_score, registered_at)
        VALUES 
        ('EMP-1042', 'Manikanta Marathi', 'manikanta.marathi@enterprise.internal', 'Principal Reliability & AI Architect', 'Platform Core & Self-Healing', 'https://api.dicebear.com/7.x/bottts/svg?seed=Manikanta', 1, 'Hyderabad HITEC City Innovation Park', 0.2, 'CORP_OFFICE_VLAN_10G', 'PRJ-PAYCORE', 48, 4.98, datetime('now')),
        ('EMP-0883', 'Priya Nair', 'priya.nair@enterprise.internal', 'Lead Distributed Systems Architect', 'Fintech & Payment Gateway', 'https://api.dicebear.com/7.x/bottts/svg?seed=Priya', 1, 'Hyderabad HITEC City Innovation Park', 0.4, 'CORP_OFFICE_VLAN_10G', 'PRJ-PAYCORE', 34, 4.92, datetime('now')),
        ('EMP-0719', 'David Chen', 'david.chen@enterprise.internal', 'Senior Cloud Security Lead', 'Security & Ingress Infrastructure', 'https://api.dicebear.com/7.x/bottts/svg?seed=David', 1, 'San Francisco Global Tech Center', 0.1, 'CORP_SECURE_ZONE', 'PRJ-AUTHGATE', 29, 4.89, datetime('now')),
        ('EMP-1055', 'Jyoti Gouda', 'jyoti.gouda@enterprise.internal', 'Lead DevOps & SRE Engineer', 'Cloud Reliability & Platform Ops', 'https://api.dicebear.com/7.x/bottts/svg?seed=Jyoti', 1, 'Hyderabad HITEC City Innovation Park', 0.3, 'CORP_OFFICE_VLAN_10G', 'PRJ-PAYCORE', 42, 4.97, datetime('now'))
        """)
        
        c.execute("""
        INSERT INTO projects (id, name, client, environment, sla, lead_emp_id, active_services)
        VALUES
        ('PRJ-PAYCORE', 'Paynest Global Core Banking & Gateway', 'Standard FinCorp International', 'AWS us-east-1 EKS Cluster', '99.999% SLA', 'EMP-1042', 'payment-service, refund-worker, settlement-engine'),
        ('PRJ-AUTHGATE', 'Zero-Trust Ingress & Microservices Auth', 'Global Enterprise Security', 'Multi-Region Cloudflare + Envoy', '99.99% SLA', 'EMP-0719', 'webhook-ingress, jwt-issuer, envoy-gateway'),
        ('PRJ-EVENTSTREAM', 'Real-Time Fraud Evaluation Stream', 'Nexus Global Banking', 'Confluent Kafka Dedicated Multi-AZ', '99.95% SLA', 'EMP-0883', 'event-stream-engine, fraud-detector, risk-scorer')
        """)

        c.execute("""
        INSERT INTO incident_solutions (id, incident_id, project_id, service, resolved_by_id, symptoms, root_cause, failed_attempts, exact_fix, file_path, exact_line, code_diff, confidence_score, occurrence_count, user_rating, external_docs_link)
        VALUES
        ('SOL-101', 'INC-101', 'PRJ-PAYCORE', 'payment-service', 'EMP-1042', 'p99 latency surged from 280ms to 6200ms; HTTP 504 Gateway Timeouts. HikariPool-1 - Connection is not available, request timed out after 30000ms.', 'Async refund worker failed to close idle DB transaction blocks after migration #4412, leaking connection pool handles.', 'DO NOT restart pods (temporary 8-min relief). DO NOT scale pods 6->14 (exhausted PostgreSQL max_connections globally and crashed replica pool).', 'Revert commit #4412 and set pool.maxLifetime=600000 with graceful drain.', 'payment-service/src/main/resources/application.properties', 42, '- spring.datasource.hikari.maxLifetime=0\n+ spring.datasource.hikari.maxLifetime=600000\n+ spring.datasource.hikari.leakDetectionThreshold=30000', 98.6, 18, 4.96, 'https://github.com/brettwooldridge/HikariCP/wiki/Bad-Behavior-Handling'),
        ('SOL-107', 'INC-107', 'PRJ-AUTHGATE', 'webhook-ingress', 'EMP-0719', 'Bank payment callbacks dropping; 42% of checkout completions stuck in PENDING. Ingress logs: SSL: CERTIFICATE_VERIFY_FAILED: certificate has expired on webhooks.paynest.io.', 'Wildcard certificate expired at 02:00 UTC due to disabled cron renewal during Ubuntu 22.04 LTS migration.', 'Forcing proxy-level verification bypass was rejected by payment compliance filter.', 'Execute certbot renewal with Cloudflare DNS challenge and reload Envoy ingress secret.', 'ingress/nginx/conf.d/webhooks.conf', 18, '- ssl_certificate /etc/letsencrypt/live/old/fullchain.pem;\n+ ssl_certificate /etc/letsencrypt/live/webhooks.paynest.io/fullchain.pem;', 99.2, 9, 5.0, 'https://letsencrypt.org/docs/automated-renewals/'),
        ('SOL-112', 'INC-112', 'PRJ-PAYCORE', 'redis-cluster-core', 'EMP-0883', 'Redis memory consumption at 98.4%, maxmemory eviction policy triggered aggressively. User sessions dropped.', 'Recommendation caching feature wrote per-user JSON blobs with zero TTL, accumulating 4.8 million persistent keys.', 'FLUSHALL flushed everything and triggered an immediate catastrophic database cache stampede.', 'Run targeted Lua script scanning rec:user:* and hotfix default 4-hour TTL in cache interceptor.', 'payment-service/src/main/java/com/paynest/cache/RedisConfig.java', 88, '- redisTemplate.opsForValue().set(key, payload);\n+ redisTemplate.opsForValue().set(key, payload, Duration.ofHours(4));', 97.4, 14, 4.9, 'https://redis.io/docs/latest/develop/use/keyspace-notifications/')
        """)

        conn.commit()
    conn.close()

init_database()
