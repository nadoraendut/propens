"""Production entry point:  gunicorn serve:app"""
from propens import create_app

app = create_app()
