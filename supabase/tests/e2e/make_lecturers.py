"""Writes lecturers.xlsx for the e2e run: 19 good rows (one on study leave) and 1 bad row."""
import datetime, os
from openpyxl import Workbook
OUT = os.environ.get("E2E_OUT", "/tmp/propens-e2e"); os.makedirs(OUT, exist_ok=True)
wb = Workbook(); ws = wb.active; ws.title = "Lecturers"
ws.append(["Staff ID", "Staff Name", "Gred Jawatan", "Bidang", "Start of Employment", "Campus", "Status", "Email"])
n = 0
for dept, size in [("Computer Science", 8), ("Mathematics", 6), ("Physics", 4)]:
    for i in range(size):
        n += 1
        ws.append([f"LEC{n:06d}", f"Lecturer {n:02d}", f"DS{41 + (n % 5) * 3}", dept, datetime.date(2000 + n, 3, 1), "Melaka" if n % 2 else "Alor Gajah", "Active", f"lec{n}@uitm.test"])
ws.append(["LEC000099", "On Study Leave", "DS52", "Computer Science", datetime.date(2001, 1, 1), "Melaka", "Study Leave", "leave@uitm.test"])
ws.append(["BAD1", "Too Short Id", "DS45", "Physics", "2010-01-01", "", "", ""])
wb.save(os.path.join(OUT, "lecturers.xlsx")); print("wrote", os.path.join(OUT, "lecturers.xlsx"))
