import os
import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

logger = logging.getLogger("bomberman.database")

# Default Postgres port 5432 as requested
POSTGRES_HOST = os.getenv("POSTGRES_HOST", "localhost")
POSTGRES_PORT = os.getenv("POSTGRES_PORT", "5432")
POSTGRES_DB = os.getenv("POSTGRES_DB", "bomberman_db")
POSTGRES_USER = os.getenv("POSTGRES_USER", "bomberman")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "bomberman_secret")

POSTGRES_URL = f"postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@{POSTGRES_HOST}:{POSTGRES_PORT}/{POSTGRES_DB}"
DATABASE_URL = os.getenv("DATABASE_URL", POSTGRES_URL)

Base = declarative_base()
engine = None
SessionLocal = None

def init_db():
    global engine, SessionLocal
    # Try connecting to PostgreSQL first
    try:
        logger.info(f"Connecting to database: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}")
        engine = create_engine(
            DATABASE_URL,
            pool_pre_ping=True,
            connect_args={"connect_timeout": 3} if "postgresql" in DATABASE_URL else {}
        )
        # Test connection
        with engine.connect() as conn:
            pass
        logger.info("[DB] Successfully connected to primary PostgreSQL database.")
    except Exception as e:
        logger.warning(f"[DB] PostgreSQL unavailable ({e}). Falling back to local SQLite for development...")
        engine = create_engine(
            "sqlite:///./bomberman.db",
            connect_args={"check_same_thread": False}
        )
        logger.info("[DB] Initialized local fallback SQLite database (bomberman.db).")

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

def get_db_session():
    global SessionLocal
    if SessionLocal is None:
        init_db()
    return SessionLocal()

def get_db():
    db = get_db_session()
    try:
        yield db
    finally:
        db.close()
