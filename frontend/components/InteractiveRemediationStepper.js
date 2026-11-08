'use client';

import React, { useState, useEffect, useRef } from 'react';

const SCENARIOS = {
  redis: {
    id: "redis",
    incidentId: "INC-112",
    title: "Redis Cluster Memory Exhaustion (SEV2)",
    service: "redis-cluster-core / payment-service",
    antiPatterns: [
      {
        action: "DO NOT execute FLUSHALL:",
        consequence: "Flushes all keys, wipes warm customer caches, and triggers an immediate catastrophic database cache stampede against PostgreSQL."
      },
      {
        action: "DO NOT scale Redis memory ceiling blindly:",
        consequence: "Without a TTL on recommendation payloads, new session objects will accumulate until physical RAM is exhausted again."
      }
    ],
    steps: [
      {
        id: 1,
        title: "Step 1: Scan & Evict Orphaned Keys via Non-Blocking Lua Script",
        summary: "Run targeted chunked SCAN and UNLINK on orphaned rec:user:* keys without blocking the single-threaded Redis engine.",
        commands: [
          "redis-cli --eval /scripts/evict_rec_keys.lua , rec:user:* 500",
          "redis-cli SCAN 0 MATCH rec:user:* COUNT 1000",
          "redis-cli INFO memory | grep used_memory_human"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Priya Nair (Lead Distributed Systems Architect)",
            date: "2024-03-16",
            incidentId: "INC-112",
            facedError: "Redis single-threaded event loop stalled for 4.2 seconds when running KEYS rec:user:*",
            howSolved: "Replaced KEYS command with non-blocking SCAN with COUNT 1000 and UNLINK instead of DEL. Never block the event loop on production clusters.",
            rating: "★ 4.9"
          },
          {
            developer: "Mikhail Petrov (Senior SRE)",
            date: "2024-03-15",
            incidentId: "INC-2024-03-15-RDS-007",
            facedError: "Engineers proposed FLUSHALL as quick fix during peak checkout traffic",
            howSolved: "Blocked FLUSHALL command in sentinel proxy. Used targeted Lua micro-batch script to evict 4.8M recommendation keys while keeping customer sessions 100% intact.",
            rating: "★ 5.0"
          }
        ],
        expectedOutput: "used_memory_human drops from 15.2G to 4.1G. Zero dropped sessions."
      },
      {
        id: 2,
        title: "Step 2: Apply 4-Hour TTL Patch in RedisConfig.java Line 88",
        summary: "Edit payment-service/src/main/java/com/paynest/cache/RedisConfig.java to enforce 4-hour expiration on recommendation payloads.",
        diff: [
          "- redisTemplate.opsForValue().set(key, payload);",
          "+ redisTemplate.opsForValue().set(key, payload, Duration.ofHours(4));"
        ],
        commands: [
          "git diff payment-service/src/main/java/com/paynest/cache/RedisConfig.java",
          "git commit -am 'fix(cache): enforce 4h TTL on recommendation payload cache (INC-112)'",
          "kubectl rollout restart deployment/payment-service"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Priya Nair (Lead Distributed Systems Architect)",
            date: "2024-03-16",
            incidentId: "INC-112",
            facedError: "Omitting Duration parameter causes Redis to assign TTL = -1 (persistent key) by default",
            howSolved: "Explicitly set Duration.ofHours(4). Coordinated with recommendation ML team to verify 4 hours matches user browsing sessions while preventing unbounded memory bloat.",
            rating: "★ 4.9"
          }
        ],
        expectedOutput: "Key TTL returns 14400 (4 hours) on rec:user:* keys."
      },
      {
        id: 3,
        title: "Step 3: Validate Memory Stability & Eviction Rate",
        summary: "Monitor memory utilization, eviction rate, and session continuity for ≥10 minutes.",
        checklist: [
          "used_memory_human < 6.0GB (<60% maxmemory ceiling)",
          "evicted_keys / sec == 0 (zero active evictions)",
          "Premature session logouts on iOS & Web == 0",
          "p99 latency < 15ms on cache reads"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Priya Nair (Lead Distributed Systems Architect)",
            date: "2024-03-16",
            incidentId: "INC-112",
            facedError: "Eviction counter continued climbing for 2 minutes post-deploy due to in-flight queue",
            howSolved: "Monitored instantaneous_ops_per_sec; eviction stopped completely once the 4h TTL patch took over incoming requests.",
            rating: "★ 4.9"
          }
        ],
        expectedOutput: "Eviction rate 0 keys/sec. Cluster memory at 42% healthy baseline."
      }
    ]
  },
  hikari: {
    id: "hikari",
    incidentId: "INC-101",
    title: "HikariPool Connection Pool Starvation (SEV1)",
    service: "payment-service / postgresql-master",
    antiPatterns: [
      {
        action: "DO NOT restart pods:",
        consequence: "Provides only ~8-minute temporary relief before the async worker leaks handles again."
      },
      {
        action: "DO NOT scale pods 6 → 14:",
        consequence: "Exhausts PostgreSQL max_connections ceiling globally and deadlocks the entire cluster."
      }
    ],
    steps: [
      {
        id: 1,
        title: "Step 1: Graceful Drain & Revert Migration",
        summary: "Gracefully drain worker pods and revert commit #4412 to stop unclosed transaction leakage.",
        commands: [
          "kubectl drain payment-service-worker --ignore-daemonsets --delete-emptydir-data",
          "git revert 4412e8a -m 'Revert async refund worker transaction block'",
          "psql -U postgres -d paycore -c \"SELECT pid, state, query_start FROM pg_stat_activity WHERE state = 'idle in transaction';\""
        ],
        pastDeveloperExperiences: [
          {
            developer: "Jenna Liu (SRE)",
            date: "2024-07-15",
            incidentId: "INC-2024-07-15-0041",
            facedError: "Revert failed with 'git error: conflict in V4412__refund_worker.sql'",
            howSolved: "Aborted merge revert, dropped only the async trigger via psql directly: 'DROP TRIGGER IF EXISTS trg_async_refund ON transactions;'",
            rating: "★ 4.9"
          },
          {
            developer: "Rohit Patel (Platform Eng)",
            date: "2023-03-22",
            incidentId: "INC-2023-03-22-0098",
            facedError: "pg_stat_activity still showed 14 lingering idle connections after pod drain",
            howSolved: "Orphaned workers held active TCP keep-alives. Ran 'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction';' to flush them immediately.",
            rating: "★ 5.0"
          }
        ],
        expectedOutput: "0 rows returned from pg_stat_activity."
      },
      {
        id: 2,
        title: "Step 2: Apply Connection-Pool Patch",
        summary: "Update application.properties at line 42 with verified HikariCP limits (maxLifetime=600000).",
        diff: [
          "- spring.datasource.hikari.maxLifetime=0",
          "+ spring.datasource.hikari.maxLifetime=600000",
          "+ spring.datasource.hikari.leakDetectionThreshold=30000"
        ],
        commands: [
          "git commit -am 'fix(db): set HikariCP maxLifetime=600000 and enable leakDetectionThreshold'",
          "kubectl rollout restart deployment/payment-service"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Manikanta Marathi (Principal SRE)",
            date: "3 weeks ago",
            incidentId: "INC-101",
            facedError: "Spring Boot startup threw 'PropertyNotFoundException' when editing properties directly",
            howSolved: "Hikari configuration was nested under 'spring.datasource.hikari.*', not the root datasource block. Ensured exact prefix matches Line 42.",
            rating: "★ 4.96"
          }
        ],
        expectedOutput: "Payment-service version 4602 successfully running."
      },
      {
        id: 3,
        title: "Step 3: Validate Post-Fix Health Metrics",
        summary: "Monitor active connection pools, PostgreSQL session counts, and p99 latency for ≥10 minutes.",
        checklist: [
          "hikari.pool.ActiveConnections <= 25 (well below max pool)",
          "pg_stat_activity idle in transaction == 0",
          "p99 latency < 2.0s on /v2/charge",
          "HTTP 504 Gateway Timeout count == 0"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Manikanta Marathi (Principal SRE)",
            date: "3 weeks ago",
            incidentId: "INC-101",
            facedError: "Temporary latency blip right after rollout",
            howSolved: "Observed 45s JVM JIT warm-up time; latency settled to 190ms once cache warmed. Do not trigger panicky secondary rollouts.",
            rating: "★ 4.96"
          }
        ],
        expectedOutput: "Clean health probe with zero timeouts."
      }
    ]
  },
  ssl: {
    id: "ssl",
    incidentId: "INC-107",
    title: "Ingress TLS Certificate Expiration (SEV2)",
    service: "ingress-gateway / webhooks.paynest.io",
    antiPatterns: [
      {
        action: "DO NOT disable SSL verification in webhook clients:",
        consequence: "Violates PCI-DSS compliance and exposes customer payment callbacks to Man-in-the-Middle attacks."
      },
      {
        action: "DO NOT restart Envoy ingress without valid cert bundle:",
        consequence: "Causes 100% gateway connection drops across all ingress endpoints."
      }
    ],
    steps: [
      {
        id: 1,
        title: "Step 1: Issue Emergency Certificate via ACME DNS Challenge",
        summary: "Run certbot with Route53 DNS validation to issue new wildcard cert for *.paynest.io without HTTP downtime.",
        commands: [
          "certbot certonly --dns-route53 -d *.paynest.io -d webhooks.paynest.io --non-interactive",
          "openssl x509 -in /etc/letsencrypt/live/paynest.io/cert.pem -noout -dates"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Marcus Vance (Security Eng)",
            date: "2024-01-10",
            incidentId: "INC-107",
            facedError: "HTTP-01 challenge failed because webhook ingress blocks plain HTTP port 80",
            howSolved: "Switched to DNS-01 challenge via Route53 IAM role. Cert issued in 42 seconds with zero ingress restarts.",
            rating: "★ 4.9"
          }
        ],
        expectedOutput: "Certificate issued valid for 90 days."
      },
      {
        id: 2,
        title: "Step 2: Hot-Reload TLS Secret in Kubernetes & Envoy Gateway",
        summary: "Update Kubernetes TLS secret and trigger zero-downtime Envoy SSL socket reload.",
        commands: [
          "kubectl create secret tls paynest-tls-cert --cert=/etc/letsencrypt/live/paynest.io/fullchain.pem --key=/etc/letsencrypt/live/paynest.io/privkey.pem --dry-run=client -o yaml | kubectl apply -f -",
          "kubectl exec -n ingress deployment/envoy-gateway -c envoy -- curl -s -XPOST http://127.0.0.1:9901/certs"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Priya Nair (Lead Distributed Systems Architect)",
            date: "2024-01-10",
            incidentId: "INC-107",
            facedError: "Envoy did not reload cert automatically from updated secret mount",
            howSolved: "Hit Envoy administration endpoint at port 9901 to hot-reload SSL context without dropping in-flight TLS handshakes.",
            rating: "★ 4.9"
          }
        ],
        expectedOutput: "Envoy SSL context reloaded with new expiry timestamp."
      },
      {
        id: 3,
        title: "Step 3: Validate TLS Handshake & Webhook Delivery",
        summary: "Verify SSL handshake with external payment gateways and confirm webhook error rate drops to 0%.",
        checklist: [
          "openssl s_client -connect webhooks.paynest.io:443 -servername webhooks.paynest.io returns Verify return code: 0 (ok)",
          "Razorpay callback HTTP 200 success rate > 99.8%",
          "Webhook latency p99 < 120ms",
          "SSL certificate expiry warning alerts cleared in Datadog"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Rohit Patel (Platform Eng)",
            date: "2024-01-10",
            incidentId: "INC-107",
            facedError: "Razorpay webhooks cached old DNS IP for 3 minutes",
            howSolved: "Monitored ingress logs until DNS TTL expired; success rate reached 100% within 180 seconds.",
            rating: "★ 4.8"
          }
        ],
        expectedOutput: "TLS handshake verified. Razorpay webhook 200 OK."
      }
    ]
  },
  novel: {
    id: "novel",
    incidentId: "COMMUNITY-941",
    title: "Kubernetes Kernel OOM-Killer (Community Intelligence)",
    service: "checkout-service-v2 / k8s-worker-node",
    antiPatterns: [
      {
        action: "DO NOT remove container memory limits completely:",
        consequence: "Runaway memory usage causes node-level Linux kernel panics and evicts critical kube-system daemons."
      },
      {
        action: "DO NOT disable swap on host without tuning vm.max_map_count:",
        consequence: "Causes JVM thread allocation failures under high-concurrency spikes."
      }
    ],
    steps: [
      {
        id: 1,
        title: "Step 1: Inspect Cgroup Memory Pressure & OOM Events",
        summary: "Analyze kernel dmesg and container cgroup memory metrics to identify runaway heap vs native memory leak.",
        commands: [
          "kubectl describe pod checkout-service-v2 | grep -A 5 'Last State: Terminated'",
          "dmesg -T | grep -i -E 'oom[-_]killer|out of memory'",
          "kubectl top pods -n default --sort-by=memory"
        ],
        pastDeveloperExperiences: [
          {
            developer: "SRE Community Lead (StackOverflow Contributor)",
            date: "2024-05-12",
            incidentId: "COMMUNITY-941",
            facedError: "JVM heap remained under 1GB while cgroup limit of 2GB was hit (Exit Code 137)",
            howSolved: "Direct ByteBuffer allocation and glibc malloc fragmentation caused native memory to exceed 1GB. Set MALLOC_ARENA_MAX=2.",
            rating: "★ 4.88"
          }
        ],
        expectedOutput: "Identified exact memory leak vector in pod cgroup."
      },
      {
        id: 2,
        title: "Step 2: Tune JVM Memory Flags & Container Resource Specs",
        summary: "Apply MALLOC_ARENA_MAX=2 and set MaxRAMPercentage=75.0 in container environment.",
        diff: [
          "- env: [{ name: 'JAVA_OPTS', value: '-Xmx1536m' }]",
          "+ env:",
          "+   - name: 'MALLOC_ARENA_MAX'",
          "+     value: '2'",
          "+   - name: 'JAVA_TOOL_OPTIONS'",
          "+     value: '-XX:MaxRAMPercentage=75.0 -XX:+ExitOnOutOfMemoryError'"
        ],
        commands: [
          "kubectl patch deployment checkout-service-v2 --patch-file patch-jvm.yaml",
          "kubectl rollout status deployment/checkout-service-v2"
        ],
        pastDeveloperExperiences: [
          {
            developer: "Arjun Rao (Kubernetes Platform Lead)",
            date: "2024-05-12",
            incidentId: "COMMUNITY-941",
            facedError: "Pod killed during startup due to memory burst",
            howSolved: "Increased container memory request from 1.5Gi to 2Gi while capping limit at 2.5Gi with 75% heap limit.",
            rating: "★ 4.95"
          }
        ],
        expectedOutput: "Deployment patched with bounded native memory."
      },
      {
        id: 3,
        title: "Step 3: Run High-Concurrency Stress Test",
        summary: "Verify pod memory stabilizes under load without cgroup throttling.",
        checklist: [
          "cgroup memory usage < 1.8GB under 5,000 req/sec",
          "Zero OOM-killer invocations in dmesg",
          "p99 latency < 250ms on /checkout",
          "Pod restarts count == 0"
        ],
        pastDeveloperExperiences: [
          {
            developer: "SRE Community Lead (StackOverflow Contributor)",
            date: "2024-05-12",
            incidentId: "COMMUNITY-941",
            facedError: "Container restarted after 4 hours under sustained traffic",
            howSolved: "Confirmed memory leak was eliminated; container ran 14 days with flat 1.4GB memory curve.",
            rating: "★ 4.9"
          }
        ],
        expectedOutput: "Stress test passed. Zero OOM kills."
      }
    ]
  }
};

export default function InteractiveRemediationStepper({ promptText = '', triageData = null, selectedUser = null }) {
  const getScenarioKey = () => {
    const text = ((promptText || '') + ' ' + (triageData?.internal_match?.incident_id || '') + ' ' + (triageData?.internal_match?.root_cause || '')).toLowerCase();
    if (text.includes('redis') || text.includes('ttl') || text.includes('eviction') || text.includes('flushall') || text.includes('keys/sec') || text.includes('inc-112')) {
      return 'redis';
    }
    if (text.includes('ssl') || text.includes('certificate') || text.includes('cert') || text.includes('expired') || text.includes('razorpay') || text.includes('inc-107')) {
      return 'ssl';
    }
    if (text.includes('oom') || text.includes('kernel') || text.includes('cgroup') || text.includes('137') || text.includes('checkout-service')) {
      return 'novel';
    }
    return 'hikari'; // default scenario (INC-101)
  };

  const scenarioKey = getScenarioKey();
  const currentScenario = SCENARIOS[scenarioKey] || SCENARIOS.hikari;
  const stepsList = currentScenario.steps;

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState([]);
  const [skippedSteps, setSkippedSteps] = useState([]);
  
  const [stepThreads, setStepThreads] = useState({ 1: [], 2: [], 3: [] });
  const [errorInput, setErrorInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [retainedSuccess, setRetainedSuccess] = useState(null);

  // Propose Alternative Solution State
  const [showAlternativeForm, setShowAlternativeForm] = useState(false);
  const [altSolutionName, setAltSolutionName] = useState('');
  const [altSolutionCode, setAltSolutionCode] = useState('');
  const [altOutcomeResult, setAltOutcomeResult] = useState('');
  const [altVerifiedWorking, setAltVerifiedWorking] = useState(false);
  const [solutionComparison, setSolutionComparison] = useState(null);
  const [altRetainSuccess, setAltRetainSuccess] = useState(false);

  // Voice Typing State
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      setSpeechSupported(true);
    }
  }, []);

  // Reset states when switching scenario
  useEffect(() => {
    setCurrentStepIndex(0);
    setCompletedSteps([]);
    setSkippedSteps([]);
    setStepThreads({ 1: [], 2: [], 3: [] });
    setErrorInput('');
    setAttachedFiles([]);
    setRetainedSuccess(null);
    setShowAlternativeForm(false);
    setSolutionComparison(null);
    setAltRetainSuccess(false);
  }, [scenarioKey]);

  const activeStep = stepsList[currentStepIndex] || stepsList[0];

  const handleNextStep = () => {
    if (!completedSteps.includes(activeStep.id)) {
      setCompletedSteps([...completedSteps, activeStep.id]);
    }
    if (currentStepIndex < stepsList.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      setShowAlternativeForm(false);
      setSolutionComparison(null);
    }
  };

  const handleSkipStep = () => {
    if (!skippedSteps.includes(activeStep.id)) {
      setSkippedSteps([...skippedSteps, activeStep.id]);
    }
    if (currentStepIndex < stepsList.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      setShowAlternativeForm(false);
      setSolutionComparison(null);
    }
  };

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    setAttachedFiles(prev => [...prev, ...files.map(f => f.name)]);
  };

  // Toggle Voice Typing (Speech to Text)
  const toggleVoiceRecording = () => {
    if (!speechSupported) {
      alert("Voice speech recognition is not supported in this browser. Please use Chrome, Edge, or a WebSpeech-compatible browser.");
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript.trim()) {
          setErrorInput(prev => (prev ? prev + ' ' : '') + transcript);
        }
      };

      recognition.onerror = (e) => {
        console.warn("Speech recognition error:", e);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error("Speech recognition start failed:", e);
      }
    }
  };

  // Handle User Chatting about Step Error
  const handleSubmitError = async (e) => {
    e.preventDefault();
    if (!errorInput.trim() && attachedFiles.length === 0) return;

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
    }

    const userMessage = {
      sender: 'user',
      text: errorInput,
      files: [...attachedFiles],
      timestamp: new Date().toLocaleTimeString()
    };

    setStepThreads(prev => ({
      ...prev,
      [activeStep.id]: [...(prev[activeStep.id] || []), userMessage]
    }));

    setErrorInput('');
    setAttachedFiles([]);
    setIsAnalyzing(true);

    setTimeout(() => {
      let aiGuide = "";
      if (scenarioKey === 'redis') {
        if (activeStep.id === 1) {
          aiGuide = "Hindsight Match (Priya Nair INC-112): If SCAN takes long or returns an error, ensure you pass COUNT 1000 so it batches keys in slices. Never run KEYS or DEL on 4.8M keys. Use UNLINK to avoid blocking the single-threaded Redis event loop.";
        } else if (activeStep.id === 2) {
          aiGuide = "Hindsight Match (Priya Nair INC-112): Verify line 88 has Duration.ofHours(4). If Spring Boot fails to compile, ensure 'import java.time.Duration;' is present at top of RedisConfig.java.";
        } else {
          aiGuide = "Hindsight Match (Mikhail Petrov INC-2024-03-15-RDS-007): Eviction counter may take 60-90 seconds to show 0 as in-flight evictions finish. Monitor with `redis-cli INFO stats | grep evicted_keys`. If it stays zero, session stability is restored.";
        }
      } else if (scenarioKey === 'ssl') {
        if (activeStep.id === 1) {
          aiGuide = "Hindsight Match (Marcus Vance INC-107): If Route53 DNS validation times out, allow 30 seconds for DNS TXT record propagation across AWS nameservers before retrying.";
        } else if (activeStep.id === 2) {
          aiGuide = "Hindsight Match (Priya Nair INC-107): Trigger Envoy admin endpoint at :9901/certs to force SSL context reload without dropping in-flight TCP connections.";
        } else {
          aiGuide = "Hindsight Match (Rohit Patel INC-107): Verify with 'openssl s_client -connect webhooks.paynest.io:443'. Ensure Verify return code: 0 (ok).";
        }
      } else if (scenarioKey === 'novel') {
        if (activeStep.id === 1) {
          aiGuide = "Global Community Match (SRE Community Lead): Exit Code 137 indicates SIGKILL by host kernel. Check dmesg -T to confirm it was cgroup OOM rather than JVM internal heap exhaustion.";
        } else if (activeStep.id === 2) {
          aiGuide = "Global Community Match (Arjun Rao): Set MALLOC_ARENA_MAX=2 to constrain glibc memory fragmentation alongside MaxRAMPercentage=75.0.";
        } else {
          aiGuide = "Global Community Match (SRE Community Lead): Check cgroup memory curve in Grafana to confirm memory plateau under 5k req/sec.";
        }
      } else {
        // hikari
        if (activeStep.id === 1) {
          aiGuide = "Hindsight Match (Rohit Patel INC-0098): Lingering idle transactions occur when TCP sockets stay alive after pod termination. Run:\n\nSELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle in transaction';\n\nThis will instantly terminate orphan connection handles without restarting Postgres.";
        } else if (activeStep.id === 2) {
          aiGuide = "Hindsight Match (Manikanta Marathi INC-101): Verify line 42 has 'spring.datasource.hikari.maxLifetime=600000'. If config reload fails, check that spring-boot-actuator refreshed without syntax errors.";
        } else {
          aiGuide = "Hindsight Match (Jenna Liu INC-0041): Allow 45-60 seconds for JVM JIT warm-up. Check 'hikari.pool.ActiveConnections'; if under 25, you are safe to proceed.";
        }
      }

      setStepThreads(prev => ({
        ...prev,
        [activeStep.id]: [
          ...(prev[activeStep.id] || []),
          {
            sender: 'ai',
            text: aiGuide,
            timestamp: new Date().toLocaleTimeString(),
            canRetain: true
          }
        ]
      }));
      setIsAnalyzing(false);
    }, 1100);
  };

  const handleRetainNewResolution = (stepId) => {
    setRetainedSuccess(stepId);
    setTimeout(() => setRetainedSuccess(null), 4000);
  };

  // Submit User's Alternative Solution for Comparison & Retention
  const handleEvaluateAlternative = (e) => {
    e.preventDefault();
    if (!altSolutionName.trim() || !altOutcomeResult.trim()) {
      alert("Please provide the solution method and the verified outcome metrics.");
      return;
    }

    if (!altVerifiedWorking) {
      alert("Please confirm the verification checkbox indicating that this outcome has been tested and verified 100% healthy.");
      return;
    }

    const originalDev = activeStep.pastDeveloperExperiences?.[0]?.developer || "Senior SRE Lead";

    setSolutionComparison({
      existingSolution: {
        author: originalDev,
        approach: activeStep.summary,
        benchmark: "MTTR: ~4-10m • Peer Rating: ★ 4.95",
        bestFor: "Default production cold-restart and verified baseline recovery."
      },
      userSolution: {
        author: selectedUser?.name || "Manikanta Marathi (Principal SRE)",
        approach: altSolutionName,
        codeOrCommand: altSolutionCode,
        outcome: altOutcomeResult,
        benchmark: "User Verified: 100% Healthy • Zero Cascading Errors",
        bestFor: "High-throughput live mitigation when fast execution is required."
      },
      recommendation: `🏆 NexusMemory Multi-Solution Consensus: Both solutions have been benchmarked into the institutional memory graph. For standard maintenance rollouts, Option A (${originalDev}) remains the primary golden runbook. For live incident triage under heavy traffic, Option B (${selectedUser?.name || 'Your solution'}) is recommended because ${altOutcomeResult}.`
    });
  };

  const handleRetainAlternativeToHindsight = () => {
    setAltRetainSuccess(true);
    setTimeout(() => {
      setAltRetainSuccess(false);
      setShowAlternativeForm(false);
      setAltSolutionName('');
      setAltSolutionCode('');
      setAltOutcomeResult('');
      setAltVerifiedWorking(false);
      setSolutionComparison(null);
    }, 4500);
  };

  return (
    <div style={{
      background: "rgba(11, 15, 25, 0.7)",
      border: "1px solid var(--border-subtle, #1e293b)",
      borderRadius: "10px",
      padding: "18px",
      color: "var(--text-primary, #f8fafc)",
      fontFamily: "inherit",
      marginTop: "12px"
    }}>
      {/* 1. INTEGRATED STEP-BY-STEP REMEDIATION & DISCUSSION */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "10px" }}>
        <div>
          <span style={{ fontSize: "13px", fontWeight: "700", color: "#38bdf8", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>⚡</span> STEP-BY-STEP REMEDIATION & DISCUSSION RUNBOOK
          </span>
          <span style={{ fontSize: "11px", color: "var(--text-muted, #94a3b8)", marginTop: "2px", display: "inline-block" }}>
            Active Incident: <strong>{currentScenario.title}</strong> ({currentScenario.incidentId})
          </span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setShowAlternativeForm(!showAlternativeForm)}
            style={{
              background: showAlternativeForm ? "rgba(245, 158, 11, 0.2)" : "rgba(59, 130, 246, 0.15)",
              color: showAlternativeForm ? "#fbbf24" : "#60a5fa",
              border: `1px solid ${showAlternativeForm ? "#f59e0b" : "#3b82f6"}`,
              padding: "5px 12px",
              borderRadius: "6px",
              fontSize: "12px",
              fontWeight: "600",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px"
            }}
          >
            <span>💡</span> {showAlternativeForm ? "Hide Workaround Form" : "Propose Alternative Solution"}
          </button>
        </div>
      </div>

      <div style={{
        background: "rgba(225, 29, 72, 0.12)",
        border: "1px solid rgba(225, 29, 72, 0.4)",
        borderRadius: "8px",
        padding: "14px 18px",
        marginBottom: "20px"
      }}>
        <div style={{ color: "#f43f5e", fontWeight: "700", fontSize: "13px", display: "flex", alignItems: "center", gap: "8px" }}>
          <span>⚠️</span> HISTORICAL ANTI-PATTERNS (FAILED ATTEMPTS - NEVER REPEAT)
        </div>
        <div style={{ fontSize: "12px", color: "#fecdd3", marginTop: "6px", lineHeight: "1.6" }}>
          {currentScenario.antiPatterns.map((ap, idx) => (
            <div key={idx}>
              ❌ <strong>{ap.action}</strong> {ap.consequence}
            </div>
          ))}
        </div>
      </div>

      {/* 2. STEPPER PROGRESS TABS */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "24px",
        gap: "8px"
      }}>
        {stepsList.map((step, idx) => {
          const isCurrent = idx === currentStepIndex;
          const isDone = completedSteps.includes(step.id);
          const isSkipped = skippedSteps.includes(step.id);

          let circleBg = "#1e293b";
          let circleColor = "#94a3b8";
          let circleBorder = "1px solid #334155";

          if (isDone) {
            circleBg = "#059669";
            circleColor = "#ffffff";
            circleBorder = "1px solid #10b981";
          } else if (isSkipped) {
            circleBg = "#d97706";
            circleColor = "#ffffff";
            circleBorder = "1px solid #f59e0b";
          } else if (isCurrent) {
            circleBg = "#2563eb";
            circleColor = "#ffffff";
            circleBorder = "2px solid #60a5fa";
          }

          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                onClick={() => setCurrentStepIndex(idx)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  transition: "background 0.2s"
                }}
              >
                <div style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: circleBg,
                  color: circleColor,
                  border: circleBorder,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: "700"
                }}>
                  {isDone ? "✓" : isSkipped ? "↷" : step.id}
                </div>
                <div style={{ textAlign: "left" }}>
                  <div style={{
                    fontSize: "13px",
                    fontWeight: isCurrent ? "700" : "500",
                    color: isCurrent ? "#ffffff" : isDone ? "#34d399" : isSkipped ? "#fbbf24" : "#94a3b8"
                  }}>
                    Step {step.id}
                  </div>
                </div>
              </button>
              {idx < stepsList.length - 1 && (
                <div style={{
                  flex: 1,
                  height: "2px",
                  background: isDone ? "#059669" : "#334155",
                  margin: "0 4px"
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* 3. PROPOSE ALTERNATIVE SOLUTION & A/B BENCHMARK COMPARISON CARD */}
      {showAlternativeForm && (
        <div style={{
          background: "rgba(30, 41, 59, 0.7)",
          border: "1px solid #3b82f6",
          borderRadius: "10px",
          padding: "20px",
          marginBottom: "20px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <h4 style={{ margin: 0, fontSize: "15px", color: "#60a5fa", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>💡</span> Propose / Submit Your Alternative Workaround for Step {activeStep.id}
            </h4>
            <span style={{ fontSize: "11px", color: "#94a3b8" }}>
              Logged by: <strong>{selectedUser?.name || "Manikanta Marathi"}</strong>
            </span>
          </div>
          <p style={{ margin: "0 0 14px 0", fontSize: "12px", color: "#cbd5e1", lineHeight: "1.5" }}>
            If you have a different solution, test it and enter your benchmark outcome below. NexusMemory will compare both approaches and synthesize a recommendation for future on-call engineers.
          </p>

          <form onSubmit={handleEvaluateAlternative}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }}>
              <div>
                <label style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8", fontWeight: "700", display: "block", marginBottom: "4px" }}>
                  Solution / Method Name
                </label>
                <input
                  type="text"
                  value={altSolutionName}
                  onChange={(e) => setAltSolutionName(e.target.value)}
                  placeholder="e.g. Non-blocking UNLINK with 100-key pipeline batching"
                  style={{
                    width: "100%",
                    background: "#030712",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#f8fafc",
                    padding: "8px 10px",
                    fontSize: "12px",
                    boxSizing: "border-box"
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8", fontWeight: "700", display: "block", marginBottom: "4px" }}>
                  Verified Outcome / Metrics
                </label>
                <input
                  type="text"
                  value={altOutcomeResult}
                  onChange={(e) => setAltOutcomeResult(e.target.value)}
                  placeholder="e.g. Memory dropped from 15GB to 3.8GB in 18s. 0ms latency spike."
                  style={{
                    width: "100%",
                    background: "#030712",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    color: "#f8fafc",
                    padding: "8px 10px",
                    fontSize: "12px",
                    boxSizing: "border-box"
                  }}
                />
              </div>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <label style={{ fontSize: "11px", textTransform: "uppercase", color: "#94a3b8", fontWeight: "700", display: "block", marginBottom: "4px" }}>
                Command / Patch Executed
              </label>
              <textarea
                rows={2}
                value={altSolutionCode}
                onChange={(e) => setAltSolutionCode(e.target.value)}
                placeholder="Paste the command, SQL, or code diff you executed..."
                style={{
                  width: "100%",
                  background: "#030712",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  color: "#f8fafc",
                  padding: "8px 10px",
                  fontSize: "12px",
                  boxSizing: "border-box",
                  fontFamily: "monospace"
                }}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: "#cbd5e1", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={altVerifiedWorking}
                  onChange={(e) => setAltVerifiedWorking(e.target.checked)}
                  style={{ accentColor: "#10b981", width: "16px", height: "16px" }}
                />
                <span>I verified this outcome resolved the incident with 100% healthy recovery</span>
              </label>

              <button
                type="submit"
                style={{
                  background: "#3b82f6",
                  border: "none",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: "600",
                  cursor: "pointer"
                }}
              >
                Evaluate & Compare Runbooks ➔
              </button>
            </div>
          </form>

          {/* Comparison Result Matrix */}
          {solutionComparison && (
            <div style={{
              background: "#0b0f19",
              border: "1px solid #1e293b",
              borderRadius: "8px",
              padding: "16px",
              marginTop: "16px"
            }}>
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#38bdf8", marginBottom: "12px", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>⚖️</span> HINDSIGHT MULTI-SOLUTION COMPARISON (WHICH IS BEST?)
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "14px" }}>
                {/* Option A: Existing Solution */}
                <div style={{
                  background: "#131b2e",
                  border: "1px solid #334155",
                  borderRadius: "6px",
                  padding: "12px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#93c5fd" }}>
                      Option A (Existing Runbook)
                    </span>
                    <span style={{ fontSize: "11px", color: "#10b981" }}>Team Verified</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginBottom: "4px" }}>
                    Author: <strong>{solutionComparison.existingSolution.author}</strong>
                  </div>
                  <div style={{ fontSize: "12px", color: "#f8fafc", marginBottom: "6px" }}>
                    {solutionComparison.existingSolution.approach}
                  </div>
                  <div style={{ fontSize: "11px", color: "#cbd5e1", background: "rgba(0,0,0,0.3)", padding: "4px 8px", borderRadius: "4px" }}>
                    {solutionComparison.existingSolution.benchmark}
                  </div>
                </div>

                {/* Option B: Newly Proposed Solution */}
                <div style={{
                  background: "#064e3b",
                  border: "1px solid #059669",
                  borderRadius: "6px",
                  padding: "12px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ fontSize: "12px", fontWeight: "700", color: "#a7f3d0" }}>
                      Option B (Your Workaround)
                    </span>
                    <span style={{ fontSize: "11px", color: "#34d399", fontWeight: "700" }}>★ Newly Verified</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#6ee7b7", marginBottom: "4px" }}>
                    Author: <strong>{solutionComparison.userSolution.author}</strong>
                  </div>
                  <div style={{ fontSize: "12px", color: "#f8fafc", marginBottom: "6px" }}>
                    {solutionComparison.userSolution.approach}
                  </div>
                  <div style={{ fontSize: "11px", color: "#d1fae5", background: "rgba(0,0,0,0.3)", padding: "4px 8px", borderRadius: "4px" }}>
                    {solutionComparison.userSolution.outcome}
                  </div>
                </div>
              </div>

              {/* Recommendation Banner */}
              <div style={{
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid #10b981",
                borderRadius: "6px",
                padding: "10px 14px",
                fontSize: "12px",
                color: "#6ee7b7",
                lineHeight: "1.5",
                marginBottom: "12px"
              }}>
                {solutionComparison.recommendation}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={handleRetainAlternativeToHindsight}
                  style={{
                    background: "#10b981",
                    border: "none",
                    color: "#ffffff",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px"
                  }}
                >
                  <span>🧠</span> Retain into Hindsight Memory Graph (For Future Employees)
                </button>
              </div>
            </div>
          )}

          {altRetainSuccess && (
            <div style={{
              background: "rgba(16, 185, 129, 0.25)",
              border: "1px solid #10b981",
              borderRadius: "6px",
              padding: "12px",
              color: "#a7f3d0",
              fontSize: "12px",
              marginTop: "12px",
              fontWeight: "600"
            }}>
              ✔ <strong>Workaround Successfully Retained into Vectorize Hindsight!</strong> Future engineers triaging this service will now see both Option A and Option B with the trade-off matrix.
            </div>
          )}
        </div>
      )}

      {/* 4. ACTIVE STEP DETAIL CARD */}
      <div style={{
        background: "var(--bg-base, #0b0f19)",
        border: "1px solid var(--border-subtle, #1e293b)",
        borderRadius: "10px",
        padding: "20px",
        marginBottom: "20px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
          <div>
            <h4 style={{ margin: 0, fontSize: "16px", color: "var(--status-emerald, #10b981)", fontWeight: "700" }}>
              {activeStep.title}
            </h4>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "var(--text-secondary, #94a3b8)" }}>
              {activeStep.summary}
            </p>
          </div>
          <span style={{ fontSize: "11px", color: "var(--text-muted, #64748b)" }}>
            Step {activeStep.id} of {stepsList.length}
          </span>
        </div>

        {/* Commands or Code Diff */}
        {activeStep.commands && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted, #64748b)", fontWeight: "700", marginBottom: "6px" }}>
              Recommended Execution Commands:
            </div>
            <div style={{
              background: "#030712",
              border: "1px solid #1f2937",
              borderRadius: "6px",
              padding: "12px 14px",
              fontFamily: "monospace",
              fontSize: "12px",
              color: "#38bdf8",
              lineHeight: "1.7",
              overflowX: "auto"
            }}>
              {activeStep.commands.map((cmd, i) => (
                <div key={i}>$ {cmd}</div>
              ))}
            </div>
          </div>
        )}

        {activeStep.diff && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted, #64748b)", fontWeight: "700", marginBottom: "6px" }}>
              Verified Production Code Patch (Diff):
            </div>
            <div style={{
              background: "#030712",
              border: "1px solid #1f2937",
              borderRadius: "6px",
              padding: "12px 14px",
              fontFamily: "monospace",
              fontSize: "12px",
              lineHeight: "1.6",
              overflowX: "auto"
            }}>
              {activeStep.diff.map((line, i) => (
                <div key={i} style={{ color: line.startsWith('+') ? "#34d399" : line.startsWith('-') ? "#f87171" : "#94a3b8" }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeStep.checklist && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", textTransform: "uppercase", color: "var(--text-muted, #64748b)", fontWeight: "700", marginBottom: "6px" }}>
              Verification Checklist:
            </div>
            <div style={{ background: "#030712", border: "1px solid #1f2937", borderRadius: "6px", padding: "12px 14px" }}>
              {activeStep.checklist.map((item, i) => (
                <div key={i} style={{ fontSize: "12px", color: "#cbd5e1", display: "flex", alignItems: "center", gap: "8px", margin: "4px 0" }}>
                  <span style={{ color: "#10b981" }}>✔</span> {item}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. WHAT PREVIOUS ENGINEERS HIT ON THIS STEP */}
        <div style={{ marginTop: "16px" }}>
          <div style={{ fontSize: "11px", textTransform: "uppercase", color: "#f59e0b", fontWeight: "700", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
            <span>📜</span> WHAT PREVIOUS ENGINEERS HIT & SOLVED ON THIS STEP
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "12px" }}>
            {activeStep.pastDeveloperExperiences.map((exp, idx) => (
              <div key={idx} style={{
                background: "#131b2e",
                border: "1px solid #1e293b",
                borderLeft: "3px solid #3b82f6",
                borderRadius: "6px",
                padding: "12px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "12px", fontWeight: "700", color: "#93c5fd", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>👤</span> {exp.developer}
                  </span>
                  <span style={{ fontSize: "11px", color: "#f59e0b", fontWeight: "600" }}>{exp.rating}</span>
                </div>
                <div style={{ fontSize: "12px", color: "#f87171", marginBottom: "4px" }}>
                  <strong>Issue Hit:</strong> {exp.facedError}
                </div>
                <div style={{ fontSize: "12px", color: "#34d399", lineHeight: "1.4" }}>
                  <strong>How Solved:</strong> {exp.howSolved}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Action Buttons: Mark Solved / Skip */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px" }}>
          <button
            type="button"
            onClick={handleSkipStep}
            style={{
              background: "transparent",
              border: "1px solid #475569",
              color: "#94a3b8",
              padding: "8px 14px",
              borderRadius: "6px",
              fontSize: "12px",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            ↷ Skip Step (Bypass & Log)
          </button>

          <button
            type="button"
            onClick={handleNextStep}
            style={{
              background: "#059669",
              border: "none",
              color: "#ffffff",
              padding: "9px 18px",
              borderRadius: "6px",
              fontSize: "13px",
              fontWeight: "600",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              boxShadow: "0 2px 8px rgba(5, 150, 105, 0.4)"
            }}
          >
            {currentStepIndex === stepsList.length - 1 ? "Finish Remediation Runbook ✓" : "Mark Step as Solved ➔"}
          </button>
        </div>
      </div>

      {/* 5. MULTIMODAL STEP DEBUGGING, CHAT & VOICE TYPING */}
      <div style={{
        background: "var(--bg-base, #0b0f19)",
        border: "1px solid var(--border-subtle, #1e293b)",
        borderRadius: "10px",
        padding: "18px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <div style={{ fontSize: "13px", fontWeight: "700", color: "#f8fafc", display: "flex", alignItems: "center", gap: "8px" }}>
            <span>💬</span> Did you get an error on Step {activeStep.id}? Chat, dictate voice, or upload logs/screenshots:
          </div>
          <span style={{ fontSize: "11px", color: "var(--status-emerald, #10b981)" }}>
            ⚡ Hindsight Continuous Learning
          </span>
        </div>

        {/* Existing Thread for this step */}
        {stepThreads[activeStep.id]?.length > 0 && (
          <div style={{ marginBottom: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {stepThreads[activeStep.id].map((msg, i) => (
              <div key={i} style={{
                background: msg.sender === 'user' ? "#1e293b" : "#064e3b",
                border: msg.sender === 'user' ? "1px solid #334155" : "1px solid #059669",
                borderRadius: "8px",
                padding: "12px",
                fontSize: "12px",
                color: "#f8fafc"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px", fontSize: "10px", color: "#94a3b8" }}>
                  <span>{msg.sender === 'user' ? 'YOU (CURRENT ON-CALL)' : 'NEXUSMEMORY ENTERPRISE GUIDANCE'}</span>
                  <span>{msg.timestamp}</span>
                </div>
                <div style={{ whiteSpace: "pre-wrap", lineHeight: "1.5" }}>{msg.text}</div>

                {msg.files?.length > 0 && (
                  <div style={{ marginTop: "6px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {msg.files.map((fn, fi) => (
                      <span key={fi} style={{ background: "#0f172a", border: "1px solid #334155", padding: "2px 8px", borderRadius: "4px", fontSize: "10px", color: "#38bdf8" }}>
                        📎 {fn}
                      </span>
                    ))}
                  </div>
                )}

                {msg.canRetain && (
                  <div style={{ marginTop: "10px", paddingTop: "8px", borderTop: "1px dashed rgba(255,255,255,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: "#a7f3d0" }}>
                      Worked for you? Retain this step so future engineers benefit immediately.
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRetainNewResolution(activeStep.id)}
                      style={{
                        background: "#10b981",
                        border: "none",
                        color: "#ffffff",
                        padding: "4px 10px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: "600",
                        cursor: "pointer"
                      }}
                    >
                      Retain to Hindsight 🧠
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {retainedSuccess === activeStep.id && (
          <div style={{
            background: "rgba(16, 185, 129, 0.2)",
            border: "1px solid #10b981",
            borderRadius: "6px",
            padding: "10px",
            color: "#6ee7b7",
            fontSize: "12px",
            marginBottom: "12px"
          }}>
            ✔ <strong>Retained to Hindsight Long-Term Memory!</strong> Linked to {currentScenario.incidentId} (Step {activeStep.id}). The next engineer triaging this service will immediately see your solution!
          </div>
        )}

        {/* Input Form with Voice Dictation & File Upload */}
        <form onSubmit={handleSubmitError}>
          <div style={{ position: "relative" }}>
            <textarea
              rows={2}
              value={errorInput}
              onChange={(e) => setErrorInput(e.target.value)}
              placeholder={`Describe or dictate your terminal error, stack trace, or questions for ${activeStep.title}...`}
              style={{
                width: "100%",
                background: "#030712",
                border: isListening ? "1px solid #ef4444" : "1px solid #1f2937",
                borderRadius: "6px",
                color: "#f8fafc",
                padding: "10px 40px 10px 10px",
                fontSize: "12px",
                boxSizing: "border-box",
                resize: "vertical"
              }}
            />

            {/* In-Textarea Mic Button */}
            <button
              type="button"
              onClick={toggleVoiceRecording}
              title={isListening ? "Stop Listening" : "Start Voice Dictation"}
              style={{
                position: "absolute",
                right: "10px",
                top: "10px",
                background: isListening ? "#ef4444" : "transparent",
                border: "none",
                borderRadius: "50%",
                width: "26px",
                height: "26px",
                color: isListening ? "#ffffff" : "#94a3b8",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                transition: "all 0.2s"
              }}
            >
              🎙️
            </button>
          </div>

          {/* Active Listening Indicator */}
          {isListening && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "6px",
              fontSize: "11px",
              color: "#f87171"
            }}>
              <span style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                background: "#ef4444",
                display: "inline-block",
                animation: "pulse 1s infinite"
              }} />
              <span>Listening... Speak naturally (transcribing directly into terminal error box)</span>
            </div>
          )}

          {attachedFiles.length > 0 && (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "6px" }}>
              {attachedFiles.map((fn, fi) => (
                <span key={fi} style={{ background: "#1e293b", border: "1px solid #334155", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", color: "#38bdf8", display: "flex", alignItems: "center", gap: "4px" }}>
                  📎 {fn}
                  <button
                    type="button"
                    onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== fi))}
                    style={{ background: "transparent", border: "none", color: "#f87171", cursor: "pointer", padding: "0 2px" }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "10px", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <label style={{
                background: "transparent",
                border: "1px solid #334155",
                color: "#94a3b8",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}>
                📁 Upload Picture / Logs / Video / Doc
                <input type="file" multiple onChange={handleFileUpload} style={{ display: "none" }} />
              </label>

              <button
                type="button"
                onClick={toggleVoiceRecording}
                style={{
                  background: isListening ? "rgba(239, 68, 68, 0.2)" : "transparent",
                  border: `1px solid ${isListening ? "#ef4444" : "#334155"}`,
                  color: isListening ? "#f87171" : "#94a3b8",
                  padding: "6px 12px",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px"
                }}
              >
                <span>🎙️</span> {isListening ? "Stop Dictation" : "Voice Typing"}
              </button>
            </div>

            <button
              type="submit"
              disabled={isAnalyzing || (!errorInput.trim() && attachedFiles.length === 0)}
              style={{
                background: isAnalyzing ? "#475569" : "#3b82f6",
                border: "none",
                color: "#ffffff",
                padding: "7px 16px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: "600",
                cursor: isAnalyzing ? "wait" : "pointer"
              }}
            >
              {isAnalyzing ? "Analyzing institutional memory..." : "Analyze & Guide ➔"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
