import os
import uvicorn
from dotenv import load_dotenv

load_dotenv()

if __name__ == "__main__":
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8000))
    print(f"\n🚀 Starting NexusMemory Universal OS Backend on http://{host}:{port}\n")
    uvicorn.run("main:app", host=host, port=port, reload=True)
