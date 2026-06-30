import os
import glob
import sqlite3
import uuid
import re
import math
from collections import Counter
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pypdf import PdfReader
from groq import Groq

# Initialize FastAPI app
app = FastAPI(title="Medical Pre-screening Chatbot API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SQLite Database Setup
DB_FILE = "db.sqlite3"

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS threads (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE
        )
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS eval_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            thread_id TEXT NOT NULL,
            faithfulness_score REAL NOT NULL,
            response_latency REAL NOT NULL,
            safety_compliant INTEGER NOT NULL,
            test_alignment INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()

# Run database initialization
init_db()

# Load PDF Context and Chunks
PDF_CONTEXT = ""  # Keep for backward compatibility/reference
DOCUMENT_LIST = []
PDF_CHUNKS = []

def extract_pdf_content():
    global PDF_CONTEXT, DOCUMENT_LIST, PDF_CHUNKS
    pdf_texts = []
    PDF_CHUNKS = []
    # Search in workspace root (parent folder of backend)
    # The workspace path is c:\Users\hp\Downloads\ManasMitra
    search_paths = ["../*.pdf", "./*.pdf"]
    pdf_files = []
    for path in search_paths:
        pdf_files.extend(glob.glob(path))
    
    # De-duplicate paths
    pdf_files = list(set([os.path.abspath(f) for f in pdf_files]))
    
    loaded_docs = []
    for pdf_file in pdf_files:
        filename = os.path.basename(pdf_file)
        try:
            reader = PdfReader(pdf_file)
            loaded_docs.append(filename)
            full_text = ""
            for page_num, page in enumerate(reader.pages):
                t = page.extract_text()
                if t and t.strip():
                    full_text += t + "\n"
                    # Add each page as a chunk
                    chunk_text = f"=== MEDICAL GUIDE: {filename} (Page {page_num + 1}) ===\n{t.strip()}\n"
                    PDF_CHUNKS.append({
                        "text": chunk_text,
                        "raw_text": t.strip(),
                        "source": filename,
                        "page": page_num + 1
                    })
            if full_text.strip():
                pdf_texts.append(f"=== MEDICAL GUIDE: {filename} ===\n{full_text}\n")
        except Exception as e:
            print(f"Error reading {filename}: {e}")
            
    PDF_CONTEXT = "\n\n".join(pdf_texts)
    DOCUMENT_LIST = loaded_docs
    print(f"Loaded {len(loaded_docs)} medical guidance files and partitioned into {len(PDF_CHUNKS)} chunks.")

# Extract PDFs on startup
extract_pdf_content()

def tokenize(text: str) -> List[str]:
    return re.findall(r'\b[a-z0-9]+\b', text.lower())

def retrieve_relevant_chunks(query: str, history: List[dict] = None, top_n: int = 4) -> str:
    if not PDF_CHUNKS:
        return "No medical guides loaded."
        
    search_terms = []
    if history:
        for msg in history[-3:]:
            search_terms.append(msg["content"])
    search_terms.append(query)
    
    search_text = " ".join(search_terms)
    query_tokens = set(tokenize(search_text))
    
    if not query_tokens:
        # If query is empty or has no alphanumeric characters, return first page of each guide as fallback
        seen_sources = set()
        top_chunks = []
        for chunk in PDF_CHUNKS:
            if chunk["source"] not in seen_sources and chunk["page"] == 1:
                seen_sources.add(chunk["source"])
                top_chunks.append(chunk)
        if not top_chunks:
            top_chunks = PDF_CHUNKS[:top_n]
        return "\n\n".join(chunk["text"] for chunk in top_chunks)
        
    num_docs = len(PDF_CHUNKS)
    
    df = {}
    for token in query_tokens:
        df[token] = sum(1 for chunk in PDF_CHUNKS if token in tokenize(chunk["raw_text"]))
        
    idf = {}
    for token in query_tokens:
        idf[token] = math.log(1.0 + float(num_docs) / (1.0 + df[token]))
        
    scored_chunks = []
    for chunk in PDF_CHUNKS:
        chunk_tokens = tokenize(chunk["raw_text"])
        chunk_counter = Counter(chunk_tokens)
        
        score = 0.0
        if chunk_tokens:
            for token in query_tokens:
                if token in chunk_counter:
                    tf = chunk_counter[token] / len(chunk_tokens)
                    score += tf * idf[token]
        
        scored_chunks.append((score, chunk))
        
    scored_chunks.sort(key=lambda x: x[0], reverse=True)
    
    if scored_chunks[0][0] == 0.0:
        seen_sources = set()
        top_chunks = []
        for chunk in PDF_CHUNKS:
            if chunk["source"] not in seen_sources and chunk["page"] == 1:
                seen_sources.add(chunk["source"])
                top_chunks.append(chunk)
        if not top_chunks:
            top_chunks = [chunk for score, chunk in scored_chunks[:top_n]]
    else:
        top_chunks = [chunk for score, chunk in scored_chunks[:top_n]]
        
    return "\n\n".join(chunk["text"] for chunk in top_chunks)

CLINICAL_DISEASES = [
    {
        "disease": "Parkinson's Disease",
        "symptoms": ["shaking", "tremor", "tremors", "stiffness", "rigidity", "slow movement", "slowness", "balance issues", "handwriting size", "resting tremor", "micrographia"],
        "questions": [
            "Have you noticed any shaking or tremors in your hands, fingers, or chin, especially when resting?",
            "Do your arms or legs feel unusually stiff, rigid, or difficult to move?",
            "Has your handwriting become noticeably smaller or crowded together recently?",
            "Do you feel that your movements are slower than usual, or that it takes more effort to start moving?",
            "Have you experienced any trouble maintaining your balance or felt unsteady when standing or walking?",
            "Do you experience vivid, active dreams where you thrash around, talk, or act them out in your sleep?"
        ],
        "test": "motor"
    },
    {
        "disease": "Alzheimer's Disease / Mild Cognitive Impairment",
        "symptoms": ["forgetfulness", "memory loss", "forgetting", "confusion", "disorientation", "losing items", "repeating questions", "misplacing things"],
        "questions": [
            "Are you experiencing difficulties remembering recent conversations, appointments, or events?",
            "Have you had trouble managing bills, checkbooks, or making financial calculations recently?",
            "Do you occasionally feel disoriented or confused about the current day, year, or location?",
            "Have you noticed difficulty finding the right words or expressing yourself clearly in conversation?",
            "Do you find it challenging to plan, organize, or complete tasks that require sequential steps?",
            "Have you misplaced personal items (e.g. keys or wallet) and found them in unusual or inappropriate places?"
        ],
        "test": "word_recognition"
    },
    {
        "disease": "Dementia with Lewy Bodies",
        "symptoms": ["visual hallucinations", "hallucination", "hallucinations", "fluctuating attention", "slowness", "stiffness", "shaking", "parkinsonism", "acting out dreams"],
        "questions": [
            "Have you experienced seeing things, shadows, or figures that other people around you could not see (visual hallucinations)?",
            "Do you notice significant fluctuations in your alertness, concentration, or confusion from day to day?",
            "Have you had vivid dreams where you physically act them out, thrash around, or fall out of bed?",
            "Have you experienced shaking tremors, slowness in movement, or muscle stiffness in your limbs?",
            "Do you feel drowsy or sleep excessively during the daytime despite getting a full night's rest?",
            "Have you had repeated falls or experienced unexplained spells of fainting or loss of consciousness?"
        ],
        "test": "cognitive"
    },
    {
        "disease": "Major Depressive Disorder",
        "symptoms": ["sadness", "low mood", "depressed", "crying", "fatigue", "loss of interest", "insomnia", "sleeping too much", "worthlessness", "guilt"],
        "questions": [
            "Have you had little interest or pleasure in doing activities you usually enjoy?",
            "Have you been feeling down, sad, depressed, empty, or hopeless?",
            "Are you experiencing trouble falling or staying asleep, or sleeping too much?",
            "Do you feel constantly tired, sluggish, or have very little energy throughout the day?",
            "Have you experienced changes in your appetite, such as overeating or having very little interest in food?",
            "Do you feel bad about yourself, feel like a failure, or feel that you have let yourself or your family down?",
            "Have you had trouble concentrating on activities like reading a newspaper, watching television, or working?"
        ],
        "test": "ryff"
    },
    {
        "disease": "Generalized Anxiety Disorder",
        "symptoms": ["anxiety", "worry", "panic", "nervousness", "restlessness", "racing heart", "panic attacks", "muscle tension", "irritability"],
        "questions": [
            "Have you been feeling nervous, anxious, or constantly on edge?",
            "Have you found yourself unable to stop or control your worrying about different situations?",
            "Do you worry excessively about multiple everyday things (health, work, chores, family)?",
            "Have you experienced trouble relaxing or felt physically restless and unable to sit still?",
            "Do you become easily annoyed, frustrated, or irritable over minor inconveniences?",
            "Have you felt afraid as if something awful or disastrous is about to happen?",
            "Do you experience physical symptoms of anxiety like a racing heart, muscle tension, or sudden panic?"
        ],
        "test": "ryff"
    },
    {
        "disease": "Huntington's Disease",
        "symptoms": ["jerky movements", "chorea", "involuntary movements", "twitching", "family history", "mood changes", "clumsiness"],
        "questions": [
            "Have you noticed any involuntary, jerky, twitching, or writhing movements in your limbs or body?",
            "Is there a family history of movement disorders, psychiatric changes, or genetic cognitive conditions?",
            "Have you noticed changes in your coordination, balance, or a tendency to stumble or drop things?",
            "Do you experience difficulties with mental processing speed, feeling like tasks take much longer to think through?",
            "Have you noticed sudden, uncharacteristic shifts in your mood, such as irritability or difficulty controlling emotions?",
            "Do you struggle with planning, organizing, or starting tasks (executive functioning difficulties)?"
        ],
        "test": "motor"
    },
    {
        "disease": "Vascular Dementia",
        "symptoms": ["sudden onset", "stepwise", "mini-stroke", "stroke", "blood pressure", "diabetes", "irregular heartbeat", "shuffling", "falls"],
        "questions": [
            "Have you experienced sudden changes in your thinking or memory, or did they get worse in a short space of time?",
            "Do you have a history of high blood pressure, diabetes, stroke, or mini-strokes (TIAs)?",
            "Have you noticed difficulty with planning, organization, or thinking speed?",
            "Have you experienced any changes in your walk, such as a shuffle, or had unexplained falls recently?"
        ],
        "test": "mini_cog"
    }
]

def get_candidate_diseases(query: str, history: List[dict] = None, top_n: int = 4) -> List[dict]:
    search_terms = []
    if history:
        for msg in history:
            if msg.get("role") == "user" and not msg.get("content", "").startswith("SYSTEM:"):
                search_terms.append(msg["content"])
    search_terms.append(query)
    
    combined_search_text = " ".join(search_terms).lower()
    search_tokens = set(tokenize(combined_search_text))
    
    scored_candidates = []
    for profile in CLINICAL_DISEASES:
        score = 0
        for symptom in profile["symptoms"]:
            if " " in symptom:
                if symptom in combined_search_text:
                    score += 3
            else:
                if symptom in search_tokens:
                    score += 1
        scored_candidates.append((score, profile))
        
    scored_candidates.sort(key=lambda x: x[0], reverse=True)
    return [candidate for score, candidate in scored_candidates[:top_n]]

# Helper function to get Groq client
def get_groq_client(api_key: Optional[str]):
    key = api_key if (api_key and api_key.strip()) else os.environ.get("GROQ_API_KEY")
    if not key:
        raise HTTPException(
            status_code=400, 
            detail="Groq API Key is missing. Please configure GROQ_API_KEY on the backend or add your Groq API key in Settings."
        )
    return Groq(api_key=key)

def translate_to_english(text: str, client: Groq) -> str:
    if not text.strip():
        return ""
    try:
        completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": "You are a translation assistant. Translate the following user symptom query into simple English. If it is already in English, return it exactly as is. Return ONLY the translated English text, with no extra commentary, introduction, or quotes."},
                {"role": "user", "content": text}
            ],
            model="llama-3.1-8b-instant",
            temperature=0.1,
            max_tokens=150,
        )
        translated = completion.choices[0].message.content.strip()
        if translated.startswith('"') and translated.endswith('"'):
            translated = translated[1:-1]
        return translated
    except Exception as e:
        print(f"Translation error, falling back to original query: {e}")
        return text

# Pydantic Schemas
class ThreadCreate(BaseModel):
    title: str

class MessageCreate(BaseModel):
    content: str

class ThreadResponse(BaseModel):
    id: str
    title: str
    created_at: str

class MessageResponse(BaseModel):
    role: str
    content: str
    created_at: str

# API Endpoints
@app.get("/api/documents")
def list_documents():
    return {"documents": DOCUMENT_LIST}

@app.get("/api/threads", response_model=List[ThreadResponse])
def get_threads(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT id, title, created_at FROM threads ORDER BY created_at DESC")
    rows = cursor.fetchall()
    return [{"id": r["id"], "title": r["title"], "created_at": r["created_at"]} for r in rows]

@app.post("/api/threads", response_model=ThreadResponse)
def create_thread(thread: ThreadCreate, db: sqlite3.Connection = Depends(get_db)):
    thread_id = str(uuid.uuid4())
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO threads (id, title) VALUES (?, ?)", 
        (thread_id, thread.title)
    )
    db.commit()
    return {"id": thread_id, "title": thread.title, "created_at": str(datetime.utcnow())}

@app.delete("/api/threads/{thread_id}")
def delete_thread(thread_id: str, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("DELETE FROM threads WHERE id = ?", (thread_id,))
    db.commit()
    return {"status": "success", "message": f"Thread {thread_id} deleted."}

@app.get("/api/threads/{thread_id}/messages", response_model=List[MessageResponse])
def get_messages(thread_id: str, db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute(
        "SELECT role, content, created_at FROM messages WHERE thread_id = ? ORDER BY id ASC", 
        (thread_id,)
    )
    rows = cursor.fetchall()
    return [{"role": r["role"], "content": r["content"], "created_at": r["created_at"]} for r in rows]

@app.post("/api/threads/{thread_id}/chat")
def chat_endpoint(
    thread_id: str, 
    msg: MessageCreate, 
    x_api_key: Optional[str] = Header(None), 
    db: sqlite3.Connection = Depends(get_db)
):
    import time
    start_time = time.time()
    
    # 1. INPUT GUARDRAILS (Crisis, Emergencies, Prompt Injection)
    crisis_keywords = ["suicide", "kill myself", "end my life", "harm myself", "die", "hanging", "overdose"]
    emergency_keywords = ["chest pain", "heart attack", "can't breathe", "stroke", "paralysis", "emergency"]
    injection_keywords = ["ignore previous instructions", "bypass system", "you are now a", "prompt injection", "ignore prompt"]
    
    user_lower = msg.content.lower()
    safety_compliant = 1
    safety_triggered = False
    safety_reply = ""
    
    if any(k in user_lower for k in crisis_keywords):
        safety_compliant = 0
        safety_triggered = True
        safety_reply = "⚠️ **IMMEDIATE CLINICAL SAFETY NOTICE**:\n\nIt seems you might be going through a difficult time. If you are having thoughts of self-harm or suicide, please seek immediate support:\n- Call **Tele-MANAS** at **14416** or **1800-891-4416** (toll-free, 24/7 in India).\n- Call the **Kiran Helpline** at **1800-599-0019**.\n- Reach out to a trusted family member, friend, or healthcare provider immediately."
        
    elif any(k in user_lower for k in emergency_keywords):
        safety_compliant = 0
        safety_triggered = True
        safety_reply = "⚠️ **IMMEDIATE MEDICAL EMERGENCY WARNING**:\n\nIf you are experiencing severe physical symptoms like sudden chest pain, breathing difficulties, or symptoms of stroke, please seek emergency medical care immediately:\n- Call **112** (emergency service in India) or go to the nearest emergency department."
        
    elif any(k in user_lower for k in injection_keywords):
        safety_compliant = 0
        safety_triggered = True
        safety_reply = "System alert: Inappropriate prompt structure detected. Please continue describing your specific physical or cognitive symptoms for pre-screening."

    if safety_triggered:
        cursor = db.cursor()
        cursor.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', ?)", (thread_id, msg.content))
        cursor.execute("INSERT INTO messages (thread_id, role, content) VALUES (?, 'assistant', ?)", (thread_id, safety_reply))
        
        latency = time.time() - start_time
        cursor.execute("""
            INSERT INTO eval_metrics (thread_id, faithfulness_score, response_latency, safety_compliant, test_alignment)
            VALUES (?, 1.0, ?, 0, 1)
        """, (thread_id, latency))
        db.commit()
        return {"role": "assistant", "content": safety_reply, "suggested_test": None, "complete": True}

    client = get_groq_client(x_api_key)
    
    # Save user message to database
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO messages (thread_id, role, content) VALUES (?, 'user', ?)",
        (thread_id, msg.content)
    )
    db.commit()
    
    # Fetch all historical messages for context
    cursor.execute(
        "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id ASC",
        (thread_id,)
    )
    history = cursor.fetchall()
    
    # Format messages for Groq API
    messages = []
    
    # Translate query to English for RAG and symptom matching
    english_query = translate_to_english(msg.content, client)
    
    # Retrieve only relevant context chunks based on user query
    relevant_context = retrieve_relevant_chunks(english_query, None, top_n=4)
    
    # Calculate top candidate diseases based on translated query
    candidates = get_candidate_diseases(english_query, None, top_n=3)
    candidates_context = ""
    for idx, c in enumerate(candidates):
        candidates_context += f"""Candidate {idx+1}: {c['disease']}
- Primary Symptoms: {", ".join(c['symptoms'])}
- Recommended Follow-up Questions: {", ".join(c['questions'])}
- Recommended Activities: {c['test']}
"""
    
    # Construct System Prompt based on pre-loaded PDFs and structured candidates
    system_prompt = f"""You are a professional, highly empathetic medical pre-screening assistant. Your goal is to guide the user through a pre-screening conversation based ONLY on their symptoms and the medical reference documents provided below.

INSTRUCTIONS:
1. Ground your responses and pre-screening logic ONLY in the provided MEDICAL GUIDES and the suspected candidate diseases listed below. Do not hallucinate or state facts not present.
2. Under no circumstances should you make a conclusive diagnosis, and DO NOT mention any disease names (e.g. Parkinson's, Alzheimer's, Huntington's, depression, anxiety, ADHD, dementia, schizophrenia, etc.) in your reply. Speak only in terms of "symptoms", "motor difficulties", "memory patterns", "mood challenges", or "behaviors".
3. Use the candidate disease information below to ask targeted follow-up questions to check if the user meets their diagnostic criteria.
4. Ask ONLY ONE clarifying question at a time to investigate their symptoms.
5. Make your responses engaging, empathetic, and detailed (up to 3-4 sentences total).
6. If the user's inquiry or symptoms are completely unrelated to any of the loaded medical guides, politely inform them that you are configured for pre-screening specific symptoms, and advise them to seek professional medical advice.
7. Evaluate the symptoms discussed. 
   - If the user describes motor issues (e.g., tremors, shaking hands, difficulty moving) and has not yet done a motor test (indicated by a message starting with 'SYSTEM: User completed the Motor (Spiral Tracing) test' in the chat history), set "suggested_test" to "motor". 
   - If they describe cognitive/memory issues (e.g. forgetting things, confusion):
     * Suggest "cognitive" (Digit Span Recall) if not done.
     * Suggest "word_recognition" (ADAS-COG Word Recognition) if not done.
     * Suggest "clock_test" (SLUMS Clock Drawing Test, tests visuospatial/executive function) if not done.
     * Suggest "faq" (Functional Activities Questionnaire, tests daily living tasks) if not done.
     * Suggest "mini_cog" (Mini-Cog Screen, tests registration and recall) if not done.
   - If they describe depression, sadness, anxiety, worry, low mood, or behavior changes:
     * Suggest "ryff" (Ryff Psychological Well-being Scale) if not done.
   - Otherwise, set "suggested_test" to null.
8. Determine if the pre-screening is complete. You should ask questions dynamically until you have enough details to generate a medical report. Once you have sufficient information to narrow down the conditions, set "complete" to true. Otherwise, set it to false.
9. If the user completes a test (indicated by a message starting with 'SYSTEM:'), acknowledge the completion briefly and empathetically (max 1 sentence), analyze the results if necessary, and ask your next symptom-related question. Do not suggest that test again.
10. FORMATTING: Separate your response into two distinct paragraphs separated by a double newline ('\n\n'). The first paragraph must acknowledge the user's response, and the second paragraph must ask the next question.
11. TEST SEPARATION: If you are recommending an activity (i.e. 'suggested_test' is NOT null), you MUST NOT ask a new question in your reply. Simply explain why the activity is recommended. Do not include any questions. Only ask a question when 'suggested_test' is null.
12. MULTILINGUAL SUPPORT: Always respond in the same language the user is using.
13. DELAYED NUMBER RECALL GAME:
    - To dynamically assess delayed recall and attention during the chat:
    - On Turn 2 or Turn 3 of the user conversation, generate a random 4-digit verification code (e.g. "To verify your session security, please remember this 4-digit code: 7392. I will ask you to repeat it later.") and tell the user to remember it.
    - On Turn 5 or Turn 6, ask the user: "Do you remember the 4-digit code I gave you earlier? Please type it."
    - Make sure to review the chat history to see if the code was already generated or asked. Do not repeat this game if already done. Acknowledge their success or incorrect recall in your next turn.

SUSPECTED CANDIDATE DISEASES:
{candidates_context}

REFERENCE MEDICAL GUIDES:
{relevant_context}

You must respond in JSON format with the following schema:
{{
  "reply": "Your reply. Format as 'Acknowledge paragraph.\\n\\nQuestion paragraph.' if suggested_test is null, or just 'Activity introduction.' if suggested_test is not null.",
  "suggested_test": "motor" or "cognitive" or "word_recognition" or "clock_test" or "faq" or "ryff" or "mini_cog" or null,
  "complete": true or false
}}
"""
    
    messages.append({"role": "system", "content": system_prompt})
    for h in history:
        messages.append({"role": h["role"], "content": h["content"]})
        
    try:
        # Request completion from Groq in JSON format
        chat_completion = client.chat.completions.create(
            messages=messages,
            model="llama-3.3-70b-versatile",
            temperature=0.3,
            max_tokens=1000,
            response_format={"type": "json_object"}
        )
        assistant_response = chat_completion.choices[0].message.content
        
        # Parse JSON response
        import json
        try:
            parsed_res = json.loads(assistant_response)
            reply = parsed_res.get("reply", "")
            suggested_test = parsed_res.get("suggested_test", None)
            complete = parsed_res.get("complete", False)
            
            # Post-process to guarantee question and test are never simultaneous
            if suggested_test:
                paragraphs = [p.strip() for p in reply.split("\n\n") if p.strip()]
                if paragraphs:
                    ack = paragraphs[0]
                    # Strip any trailing question from acknowledgment just in case
                    if "?" in ack:
                        sentences = re.split(r'(?<=[.!?])\s+', ack)
                        sentences = [s for s in sentences if "?" not in s]
                        ack = " ".join(sentences)
                    
                    test_display_name = suggested_test.replace('_', ' ')
                    if test_display_name == "faq":
                        test_display_name = "Functional Activities Checklist"
                    elif test_display_name == "clock test":
                        test_display_name = "Clock Setting"
                        
                    reply = ack + "\n\n" + f"To help evaluate these symptoms, please complete the recommended {test_display_name} activity below."
        except Exception as json_err:
            print(f"Error parsing JSON from Groq: {json_err}. Raw response: {assistant_response}")
            reply = assistant_response
            suggested_test = None
            complete = False
            safety_compliant = 0
            
        # 2. OUTPUT GUARDRAILS (Scrubbing prohibited disease names)
        replacements = {
            r"(?i)\bparkinson's(?:\s+disease)?\b": "motor-related symptoms",
            r"(?i)\balzheimer's(?:\s+disease)?\b": "cognitive/memory patterns",
            r"(?i)\bdementia\b": "cognitive changes",
            r"(?i)\bhuntington's(?:\s+disease)?\b": "genetic motor symptoms",
            r"(?i)\bdepression\b": "mood challenges",
            r"(?i)\banxiety\b": "restlessness challenges"
        }
        scrubbed_reply = reply
        for pattern, repl in replacements.items():
            if re.search(pattern, scrubbed_reply):
                safety_compliant = 0
                scrubbed_reply = re.sub(pattern, repl, scrubbed_reply)
        reply = scrubbed_reply
        
        # Save assistant message to database (conversational text only)
        cursor.execute(
            "INSERT INTO messages (thread_id, role, content) VALUES (?, 'assistant', ?)",
            (thread_id, reply)
        )
        db.commit()
        
        # 3. LLM EVALUATION METRICS LOGGING
        latency = time.time() - start_time
        
        reply_tokens = set(tokenize(reply))
        context_tokens = set(tokenize(relevant_context))
        if reply_tokens:
            faithfulness = len(reply_tokens.intersection(context_tokens)) / len(reply_tokens)
        else:
            faithfulness = 1.0
            
        test_alignment = 1
        if suggested_test:
            matching_test = any(c["test"] == suggested_test for c in candidates)
            if not matching_test:
                test_alignment = 0
                
        cursor.execute("""
            INSERT INTO eval_metrics (thread_id, faithfulness_score, response_latency, safety_compliant, test_alignment)
            VALUES (?, ?, ?, ?, ?)
        """, (thread_id, faithfulness, latency, safety_compliant, test_alignment))
        db.commit()
        
        # Update thread title dynamically if it was set to "New Session"
        cursor.execute("SELECT title FROM threads WHERE id = ?", (thread_id,))
        title_row = cursor.fetchone()
        if title_row and title_row["title"] in ("New Session", "New Chat"):
            title_completion = client.chat.completions.create(
                messages=[
                    {"role": "system", "content": "You are a helpful assistant. Generate a highly concise title (maximum 3-4 words) summarize the following user concern. Do not use quotes, punctuation, or preamble. Just return the title."},
                    {"role": "user", "content": msg.content}
                ],
                model="llama-3.1-8b-instant",
                temperature=0.1,
                max_tokens=15,
            )
            new_title = title_completion.choices[0].message.content.strip().replace('"', '')
            cursor.execute("UPDATE threads SET title = ? WHERE id = ?", (new_title, thread_id))
            db.commit()
            
        return {"role": "assistant", "content": reply, "suggested_test": suggested_test, "complete": complete}
        
    except Exception as e:
        cursor.execute("DELETE FROM messages WHERE thread_id = ? AND content = ? AND role = 'user'", (thread_id, msg.content))
        db.commit()
        raise HTTPException(status_code=500, detail=f"Groq API Error: {str(e)}")

@app.post("/api/threads/{thread_id}/report")
def generate_report(
    thread_id: str,
    x_api_key: Optional[str] = Header(None),
    db: sqlite3.Connection = Depends(get_db)
):
    client = get_groq_client(x_api_key)
    
    # Fetch all historical messages for context
    cursor = db.cursor()
    cursor.execute(
        "SELECT role, content FROM messages WHERE thread_id = ? ORDER BY id ASC",
        (thread_id,)
    )
    history = cursor.fetchall()
    
    if len(history) < 2:
        raise HTTPException(
            status_code=400,
            detail="Not enough conversation history to generate a report. Please discuss your symptoms with the chatbot first."
        )
        
    # Format messages for Groq API
    conversation_text = ""
    for h in history:
        conversation_text += f"{h['role'].upper()}: {h['content']}\n\n"
        
    # Retrieve relevant context chunks for report generation
    history_dicts = [{"role": h["role"], "content": h["content"]} for h in history]
    conversation_summary_query = " ".join([h["content"] for h in history if h["role"] == "user"])
    relevant_context = retrieve_relevant_chunks(conversation_summary_query, history_dicts, top_n=6)
        
    report_system_prompt = f"""You are a professional medical report writing assistant.
Your task is to compile a pre-screening summary report based on the conversation log between a pre-screening assistant and a user.

INSTRUCTIONS:
You MUST format the report EXACTLY with the following structure, headers, and markdown tables to mirror the professional 'Document(3).pdf' clinical report style:

# PRAXIA TECH
## NEUROCOGNITIVE ASSESSMENT CENTER
### CONFIDENTIAL REPORT
**Cognitive Assessment / Pre-screening Summary Report**

**Report Date**: {datetime.utcnow().strftime("%d-%b-%Y")}
**Generated on**: {datetime.utcnow().strftime("%d-%b-%Y at %I:%M %p")}

---

### PATIENT DEMOGRAPHICS & ENCOUNTER
- **Patient Name**: User / Participant
- **Date of Assessment**: {datetime.utcnow().strftime("%d-%b-%Y")}
- **Time of Assessment**: {datetime.utcnow().strftime("%I:%M %p")}
- **Status**: COMPLETED
- **Referring Facility**: -
- **Ordering Provider**: -

---

### CLINICAL IMPRESSION & OVERALL SCORE
- **Overall Score**: [Generate/estimate an overall score out of 100 based on symptom matches and test results, e.g. 37/100]
- **Risk Category**: [Determine category: LOW CONCERN, MILD CONCERN, MODERATE CONCERN, HIGH CONCERN]
- **Clinical Summary**: [A 3-4 sentence clinical summary explaining the patient's score, symptoms, and risk classification based on the conversation and reference guides.]

---

### CLINICAL HYPOTHESES & LIKELIHOOD
Evaluate the conversation and test results to identify which specific neurological or psychiatric conditions/diseases are suspected, and output them in this exact Markdown table format:
| SUSPECTED CONDITION / DISEASE | LIKELIHOOD | PRIMARY MATCHING SYMPTOMS | CRITERIA MATCHED / REASONS |
| :--- | :--- | :--- | :--- |
| [e.g., Alzheimer's Disease / MCI] | [e.g., High / Medium / Low] | [List reported symptoms] | [Explain which diagnostic criteria/reference guides match] |
| [e.g., Generalized Anxiety Disorder] | ... | ... | ... |

---

### NEUROCOGNITIVE DOMAIN BREAKDOWN
Provide a breakdown of domains evaluated during the session (Visuospatial, Mood, Executive, Language, Memory) based on user symptoms and any test results in a Markdown table:
| DOMAIN | RAW SCORE | WEIGHTED | PERCENTILE | CLINICAL STATUS |
| Visuospatial | [e.g. 5.0 / 6.0] | [e.g. 8.3 / 10] | [e.g. 83.3%] | [e.g. Significant Impairment / Within Normal Limits] |
| Mood | [e.g. 2.0 / 9.0] | [e.g. 2.2 / 10] | [e.g. 22.2%] | ... |
| Executive | ... | ... | ... | ... |
| Language | ... | ... | ... | ... |
| Memory | ... | ... | ... | ... |

---

### REFERENCE RANGES
| SCORE RANGE | RISK CLASSIFICATION | RECOMMENDED CLINICAL ACTION |
| :--- | :--- | :--- |
| 0 - 20 | Low Concern | Routine Monitoring |
| 21 - 45 | Mild Concern | Observe Symptoms |
| 46 - 65 | Moderate Concern | Clinical Consultation |
| 66 - 100 | High Concern | Immediate Evaluation |

---

### APPENDIX A: DETAILED ASSESSMENT RESPONSES
Provide the itemized dialogue verification audit in this exact table format:
| ITEM NO. | CLINICAL PROMPT / QUESTION | DOMAIN | PATIENT RESPONSE | AI CLINICAL IMPRESSION | VERDICT / IMPLICATION |
| :--- | :--- | :--- | :--- | :--- | :--- |
For EACH question asked by the chatbot during the conversation, list it as a row mapping to its Domain, what the User answered, what you (the AI) thought of that answer, and the final verdict or implication.

---

### ELECTRONICALLY SIGNED BY
- Pre-screening Assistant Bot

**DISCLAIMER**: This automated neurocognitive assessment report is intended to serve as an adjunctive pre-screening tool. It does not constitute a definitive medical diagnosis and should not replace comprehensive clinical evaluation by a qualified healthcare professional. All findings should be interpreted in the context of the patient's full medical history and clinical presentation.

REFERENCE MEDICAL GUIDES:
{relevant_context}
"""

    try:
        report_completion = client.chat.completions.create(
            messages=[
                {"role": "system", "content": report_system_prompt},
                {"role": "user", "content": f"Please generate the pre-screening report for this conversation:\n\n{conversation_text}"}
            ],
            model="llama-3.3-70b-versatile",
            temperature=0.2,
            max_tokens=2000,
        )
        report_content = report_completion.choices[0].message.content
        return {"report": report_content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Groq API Error during report generation: {str(e)}")

@app.get("/api/metrics")
def get_evaluation_metrics(db: sqlite3.Connection = Depends(get_db)):
    cursor = db.cursor()
    cursor.execute("SELECT COUNT(*) as count, AVG(faithfulness_score) as avg_faithfulness, AVG(response_latency) as avg_latency, SUM(safety_compliant) as safety_compliant_sum, AVG(test_alignment) as avg_alignment FROM eval_metrics")
    row = cursor.fetchone()
    
    total_queries = row["count"] or 0
    avg_faithfulness = round(row["avg_faithfulness"] or 0.0, 2)
    avg_latency = round(row["avg_latency"] or 0.0, 2)
    safety_compliant_sum = row["safety_compliant_sum"] or 0
    avg_alignment = round(row["avg_alignment"] or 0.0, 2)
    
    safety_compliance_rate = round((safety_compliant_sum / total_queries * 100) if total_queries > 0 else 100.0, 1)
    
    return {
        "total_queries": total_queries,
        "average_faithfulness": avg_faithfulness,
        "average_latency_seconds": avg_latency,
        "safety_compliance_rate_percent": safety_compliance_rate,
        "test_alignment_rate_percent": round(avg_alignment * 100, 1)
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
