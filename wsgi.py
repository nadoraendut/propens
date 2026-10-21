"""Production entry point:  gunicorn wsgi:app"""
from propens import create_app

app = create_app()
