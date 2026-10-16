"""PRO-PENS rubric (Rubrik Pemantauan Pensyarah, Mac-Ogos 2026) and its scoring rules.

Content is transcribed from the official form. Scoring:
    raw   = sum of the 29 item scores (1-5), max 145
    TS    = raw x 50 / 145           (/50)
    TAS   = TS x 2 = raw x 100 / 145 (/100)  <- the mark stored for the audit
"""

SCALE = ["Sangat Lemah", "Lemah", "Memuaskan", "Baik", "Cemerlang"]  # scores 1..5
MAX_RAW = 145

# (min TAS, label) highest first -- indicator table printed on the form.
INDICATORS = [(90, "Cemerlang / Excellent"), (80, "Baik / Good"), (70, "Memuaskan / Satisfactory"),
              (60, "Lemah / Poor"), (0, "Sangat Lemah / Very Poor")]

CEMERLANG_MIN = INDICATORS[0][0]   # 90: final mark at or above this is rated Cemerlang

_ATT = "(komited, berdedikasi, bermotivasi / bersemangat) terhadap pengajaran dan pembelajaran"
_Q = "kepada persoalan pelajar (kekeliruan pelajar, masalah, kesulitan menyiapkan tugasan, dll) semasa pengajaran"
_TPC = "terma, konsep dan prinsip"
_SEQ = "pengajaran semasa dengan pengajaran lepas/ akan datang"


def _item(no, bm, en, d, note=None):
    return {"no": no, "bm": bm, "en": en, "levels": d, "note": note}


SECTIONS = [
    {"key": "A", "title": "A: PERANCANGAN PENGAJARAN (PdP)", "items": [
        _item(1, "Menyatakan 'di mana kita berada' dari segi skema kerja/ silibus.",
              "Describe 'where are we' in terms of the scheme of work/ syllabus.",
              ["Penerangan yang sangat sedikit atau tiada langsung tentang skema kerja/ silibus.",
               "Hanya penerangan yang asas tentang skema kerja / silibus.",
               "Penerangan yang baik tetapi kurang terperinci tentang skema kerja/ silibus.",
               "Penerangan yang baik dan terperinci tentang skema kerja/ silibus.",
               "Penerangan yang jelas, terperinci dan lengkap tentang skema kerja/ silibus."]),
        _item(2, "Mengimbas kembali pengajaran sebelumnya.", "Recap previous lesson.",
              ["Tiada atau sangat sedikit mengimbas kembali pengajaran sebelumnya.",
               "Ada mengimbas kembali pengajaran sebelumnya secara ringkas.",
               "Penerangan yang baik di dalam mengimbas kembali pengajaran sebelumnya.",
               "Penerangan yang baik dan jelas di dalam mengimbas kembali pengajaran sebelumnya.",
               "Penerangan yang sangat baik dan jelas di dalam mengimbas kembali pengajaran sebelumnya."]),
        _item(3, "Membentang gambaran keseluruhan (contoh: objektif, hasil, dll.) untuk pengajaran semasa.",
              "Present overview (example: objectives, outcomes, etc.) of current lesson.",
              ["Penerangan yang sangat sedikit atau tiada langsung tentang rangka pengajaran untuk kelas ini.",
               "Hanya penerangan yang asas tentang rangka pengajaran untuk kelas ini.",
               "Penerangan yang baik tetapi kurang terperinci tentang rangka pengajaran.",
               "Penerangan yang sangat baik dan terperinci tentang rangka pengajaran.",
               "Penerangan yang jelas, terperinci dan lengkap tentang rangka pengajaran."]),
        _item(4, "Mempunyai bahan/aktiviti/peralatan/teknologi yang sesuai untuk pengajaran.",
              "Has suitable materials/activities/ equipment/technology ready for lesson.",
              ["Tiada atau sangat kurang bersedia dengan bahan-bahan pengajaran yang sesuai.",
               "Ada mempunyai bahan pengajaran yang sesuai tetapi masih banyak yang perlu disediakan.",
               "Persediaan yang baik dengan bahan/aktiviti/ peralatan/ teknologi yang sesuai untuk pengajaran.",
               "Persediaan yang sangat baik dengan bahan/aktiviti/ peralatan/ teknologi yang sesuai untuk pengajaran.",
               "Sempurna dalam persediaan dengan bahan/aktiviti/ peralatan/ teknologi yang sesuai untuk pengajaran."]),
        _item(5, "Merancang pengajaran dengan mengambil kira pemahaman dan kebolehcapaian pelajar.",
              "Plan lesson by taking into consideration student's understandability and accessability.",
              ["Tiada atau sangat kurang mengambil kira kebolehcapaian pelajar dalam PdP.",
               "Ada mengambil kira kebolehcapaian pelajar dalam PdP tetapi masih banyak yang perlu dilakukan.",
               "Mengambil kira kebolehcapaian pelajar dalam PdP dengan baik.",
               "Mengambil kira kebolehcapaian pelajar dalam PdP dengan sangat baik.",
               "Mengambil kira kebolehcapaian pelajar dalam PdP dengan sangat baik dan terperinci."]),
    ]},
    {"key": "B1", "title": "B1: KAEDAH PENYAMPAIAN (Pelaksanaan Pengajaran PdP)", "items": [
        _item(6, "Berkomunikasi dengan jelas dan boleh difahami oleh pelajar.",
              "Communicate clearly and can be understood by students.",
              ["Tidak jelas dalam berkomunikasi.", "Belum cukup jelas dalam berkomunikasi.",
               "Jelas dalam berkomunikasi.", "Sangat jelas dalam berkomunikasi.",
               "Cemerlang dalam berkomunikasi."],
              note="Nota: Bahasa pengantar mestilah mengikut keperluan kursus. / Note: The medium of "
                   "instruction (language) must be in accordance with the requirements of the course."),
        _item(7, "Menggunakan platform/ sistem/ perisian/ aplikasi pengajaran (cth: Google, LMS, PowerPoint, "
                 "Padlet, Kahoot!, dll) dengan berkesan.",
              "Use teaching platform/ system/ software/ applications. (ex: Google, LMS, PowerPoint, Padlet, "
              "Kahoot!, etc.) effectively.",
              ["Tidak atau hanya menggunakan satu kaedah pengajaran.",
               "Menggunakan beberapa kaedah pengajaran tetapi masih belum berkesan pada PdP.",
               "Menggunakan beberapa kaedah pengajaran dengan baik dan agak berkesan pada PdP.",
               "Menggunakan pelbagai kaedah pengajaran dengan sangat berkesan pada PdP.",
               "Menggunakan pelbagai kaedah pengajaran dengan sempurna serta amat berkesan pada PdP."]),
        _item(8, "Menggunakan strategi pengajaran (contoh: demonstrasi, perbincangan, syarahan, main peranan, "
                 "lakonan, dll.) yang sesuai untuk mencapai objektif pengajaran.",
              "Use appropriate teaching strategies (Ex: demonstration, discussion, lecture, role play, etc.) "
              "to meet the lesson's objectives.",
              ["Tidak menggunakan strategi pengajaran yang sesuai untuk capai objektif pengajaran.",
               "Kurang menggunakan strategi pengajaran yang sesuai untuk capai objektif pengajaran.",
               "Menggunakan strategi pengajaran tetapi masih kurang lengkap bagi mencapai objektif pengajaran.",
               "Menggunakan strategi pengajaran dan hampir lengkap bagi mencapai objektif pengajaran.",
               "Menggunakan strategi pengajaran yang lengkap bagi mencapai objektif pengajaran."]),
        _item(9, "Mengajar pada kadar kelajuan yang sesuai.", "Pace lesson appropriately.",
              ["Terlalu laju bagi sesi PdP.", "Mengajar pada kelajuan yang sederhana.",
               "Kadar kelajuan yang baik dan masih boleh diperbaiki.", "Kadar kelajuan yang sangat baik.",
               "Kadar kelajuan yang sesuai dan sangat baik."]),
        _item(10, "Berkongsi konsep penting secara visual (cth: infografik, carta & graf, pembentangan, "
                  "peta minda, anotasi, video, dll)",
              "Share key concepts visually (ex: infographics, charts and graphs, presentations, mind maps, "
              "annotations, videos, etc.)",
              ["Hanya berkongsi konsep penting secara lisan.",
               "Berkongsi konsep penting secara visual dengan menggunakan papan putih sahaja.",
               "Perkongsian yang baik dalam konsep penting secara visual dengan papan putih dan bahan edaran.",
               "Perkongsian yang sangat baik dalam konsep penting secara visual dengan papan putih, edaran "
               "dan bahan slaid.",
               "Berkongsi konsep penting secara visual dengan menggunakan papan putih, bahan edaran, slaid "
               "dan teknologi-teknologi lain."]),
        _item(11, "Menghubungkait pengajaran kepada pengetahuan sedia ada pelajar/ contoh dalam kehidupan seharian.",
              "Relate lesson to students' prior knowledge/ real life examples.",
              ["Tidak menghubungkait pengajaran kepada pengetahuan sedia ada pelajar/ contoh dalam kehidupan seharian.",
               "Kurang menghubungkait pengajaran kepada pengetahuan sedia ada pelajar/ contoh dalam kehidupan seharian.",
               "Ada menghubungkait pengajaran kepada pengetahuan sedia ada pelajar/ contoh dalam kehidupan "
               "seharian tetapi masih boleh diperbaiki.",
               "Hampir cemerlang dalam menghubungkait pengajaran kepada pengetahuan sedia ada pelajar/ contoh "
               "dalam kehidupan seharian.",
               "Dapat menghubungkait pengajaran kepada pengetahuan sedia ada pelajar/ contoh dalam kehidupan "
               "seharian dengan cemerlangnya."]),
        _item(12, "Menyisip nilai di dalam pengajaran dan pembelajaran.", "Embed values in teaching and learning.",
              ["Tiada sisipan nilai-nilai murni dalam PdP.", "Kurang menyisip nilai-nilai murni dalam PdP.",
               "Ada menyisip nilai-nilai murni dalam PdP tetapi masih boleh diperbaiki.",
               "Banyak menyisip nilai-nilai murni dalam PdP.", "Sangat banyak menyisip nilai murni dalam PdP."]),
    ]},
    {"key": "B2", "title": "B2: SUSUNAN ISI KANDUNGAN (Pelaksanaan Pengajaran PdP)", "items": [
        _item(13, "Menggunakan terma, konsep, prinsip dan contoh yang sesuai dgn jelas.",
              "Use appropriate terms, concepts, principles, and clear examples.",
              [f"Tidak dapat menjelaskan {_TPC} dengan jelas.", f"Menjelaskan {_TPC} dengan kurang jelas.",
               f"Menjelaskan {_TPC} dengan jelas tetapi kurang lancar.",
               f"Dapat menjelaskan {_TPC} dengan sangat jelas dan hampir lancar.",
               f"Dapat menjelaskan {_TPC} dengan sangat jelas dan lancar."]),
        _item(14, "Merumuskan/ mengukuhkan isi penting.", "Summarise/ reinforce important points.",
              ["Tidak merumuskan/ mengukuhkan isi penting.", "Kurang merumuskan/ mengukuhkan isi penting.",
               "Ada merumuskan/ mengukuhkan isi penting tetapi pada tahap sederhana.",
               "Dapat merumuskan/ mengukuhkan isi penting dengan sangat baik.",
               "Dapat merumuskan/ mengukuhkan isi penting dengan cemerlangnya."]),
        _item(15, "Menghubungkaitkan topik semasa dengan konsep lazim.", "Relate current topics to familiar concepts.",
              ["Tidak menghubungkaitkan topik semasa dengan konsep lazim.",
               "Kurang menghubungkaitkan topik semasa dengan konsep lazim.",
               "Ada menghubungkaitkan topik semasa dengan konsep lazim tetapi pada tahap sederhana.",
               "Dapat menghubungkaitkan topik semasa dengan konsep lazim.",
               "Dapat menghubungkaitkan dengan cemerlangnya topik semasa dengan konsep lazim."]),
        _item(16, "Menggunakan peralihan yang jelas dari satu topik/ aktiviti ke topik yg lain.", "",
              ["Tidak menggunakan peralihan yang jelas dari satu topik/ aktiviti ke topik yg lain.",
               "Kurang menggunakan peralihan yang jelas dari satu topik/ aktiviti ke topik yg lain.",
               "Menggunakan peralihan yang agak jelas dari satu topik/ aktiviti ke topik yg lain.",
               "Menggunakan peralihan yang sangat jelas dari satu topik/ aktiviti ke topik yg lain.",
               "Menggunakan peralihan dengan cemerlangnya dari satu topik/ aktiviti ke topik yg lain."]),
        _item(17, "Menghubungkaitkan pengajaran semasa dengan pengajaran lepas/ akan datang.",
              "Relate lesson to previous/ future lesson.",
              [f"Tidak menghubungkaitkan {_SEQ}.", f"Kurang menghubungkaitkan {_SEQ}.",
               f"Ada menghubungkaitkan {_SEQ} tetapi pada tahap sederhana.",
               f"Dapat menghubungkaitkan {_SEQ} dengan sangat baik.",
               f"Dapat menghubungkaitkan {_SEQ} dengan cemerlangnya."]),
    ]},
    {"key": "B3", "title": "B3: INTERAKSI (Pelaksanaan Pengajaran PdP)", "items": [
        _item(18, "Memastikan kehadiran dan kesediaan pelajar.", "Confirm students' attendance and readiness.",
              ["Tidak mengambil kehadiran pelajar dan tidak bertanya kesediaan pelajar utk sesi pembelajaran.",
               "Ada mengambil kehadiran pelajar tetapi tidak bertanya kesediaan pelajar utk sesi pembelajaran.",
               "Mengambil kehadiran pelajar dan bertanya kesediaan pelajar utk sesi pembelajaran.",
               "Mengambil kehadiran pelajar dan bertanya kesediaan pelajar utk sesi pembelajaran dengan jelas.",
               "Mengambil kehadiran pelajar dan bertanya kesediaan pelajar utk sesi pembelajaran dengan "
               "jelas dan terperinci."]),
        _item(19, "Memastikan pelajar mempunyai akses kpd bahan dan sumber pembelajaran yang sangat diperlukan.",
              "Ensure students have access to necessary learning materials and resources.",
              ["Tidak memberi perhatian kepada pelajar tentang keperluan akses kepada sumber pembelajaran.",
               "Kurang memberi perhatian kepada pelajar tentang keperluan akses kepada sumber pembelajaran.",
               "Ada memberi perhatian kepada pelajar tentang keperluan akses kepada sumber pembelajaran.",
               "Memberi perhatian yang tinggi kepada pelajar tentang keperluan akses kepada sumber pembelajaran.",
               "Memberi perhatian yang sangat tinggi kpd pelajar tentang keperluan akses kpd sumber pembelajaran."]),
        _item(20, "Menggalakkan penglibatan pelajar (cth: soalan, komen, respons, dll).",
              "Invite students' participation ( ex: questions, comments, responses, etc.)",
              ["Tidak menggalakkan penglibatan pelajar (soalan, komen, dll).",
               "Kurang menggalakkan penglibatan pelajar (soalan, komen, respons dll).",
               "Ada menggalakkan penglibatan pelajar (soalan, komen, dll) tetapi pada tahap sederhana.",
               "Dapat menggalakkan dengan banyak penglibatan pelajar (soalan, komen, respons, dll).",
               "Dapat menggalakkan dengan sangat banyak penglibatan pelajar (soalan, komen, respons, dll)."]),
        _item(21, "Memberi respon kepada persoalan pelajar ( kekeliruan pelajar, masalah,kesulitan menyiapkan "
                  "tugasan ,dll) semasa pengajaran.",
              "Respond to queries (students' confusion, problems, difficulties to complete tasks, etc.) "
              "raised during lesson.",
              [f"Tidak memberi respon {_Q}.", f"Kurang memberi respon {_Q}.",
               f"Ada memberi respon {_Q} tetapi pada tahap sederhana.",
               f"Banyak memberi respon {_Q}.", f"Sangat banyak memberi respon {_Q}."]),
        _item(22, "Bertanya soalan secara berkala untuk mengetahui tahap kefahaman pelajar.",
              "Ask questions periodically to gauge students' understanding.",
              ["Tidak bertanya soalan secara berkala untuk mengetahui tahap kefahaman pelajar.",
               "Kurang bertanya soalan secara berkala untuk mengetahui tahap kefahaman pelajar.",
               "Ada bertanya soalan secara berkala untuk mengetahui tahap kefahaman pelajar tetapi pada "
               "tahap sederhana.",
               "Banyak bertanya soalan secara berkala untuk mengetahui tahap kefahaman pelajar.",
               "Sangat banyak bertanya soalan secara berkala untuk mengetahui tahap kefahaman pelajar."]),
        _item(23, "Memberi perhatian kepada semua pelajar.", "Give attention to as many students.",
              ["Tidak memberi perhatian kepada semua pelajar.", "Kurang memberi perhatian kepada semua pelajar.",
               "Ada memberi perhatian kepada semua pelajar tetapi pada tahap sederhana.",
               "Banyak memberi perhatian kepada semua pelajar.",
               "Sangat banyak memberi perhatian kepada semua pelajar."]),
    ]},
    {"key": "C", "title": "C: PROFESIONALISME", "items": [
        _item(24, "Memulakan kuliah pd masa yang ditetapkan.", "Begin class according to the schedule time.",
              ["Memulakan kuliah lebih 15 minit lewat.", "Memulakan kuliah 15 minit lewat.",
               "Memulakan kuliah 10 minit lewat.", "Memulakan kuliah 5 minit lewat.",
               "Memulakan kuliah pada masa yg ditetapkan."]),
        _item(25, "Memastikan keberadaan pensyarah di dlm kelas sepanjang proses PdP.", "Assurance presence.",
              ["Tidak berada bersama pelajar sepanjang sesi PdP (mengikut kaedah yg sesuai).",
               "Berada bersama pelajar seketika shj sepanjang sesi PdP (mengikut kaedah yg sesuai).",
               "Berada bersama pelajar sepanjang sesi PdP (mengikut kaedah yg sesuai).",
               "Berada bersama pelajar sepanjang sesi PdP dan berinteraksi dengan pelajar dengan baik "
               "(mengikut kaedah yg sesuai).",
               "Berada bersama pelajar sepanjang sesi PdP dan berinteraksi dgn pelajar dengan sgt baik "
               "(mengikut kaedah yg sesuai)."]),
        _item(26, "Berpakaian sopan dan sesuai utk sesi PdP.",
              "Dress decently and appropriate for teaching & learning sessions.",
              ["Berpakaian tidak sopan dan tidak sesuai utk sesi PdP.",
               "Berpakaian kurang sopan dan kurang sesuai utk sesi PdP.",
               "Berpakaian sopan tetapi kurang sesuai utk sesi PdP.",
               "Berpakaian sopan dan sesuai utk sesi PdP.",
               "Berpakaian sangat sopan dan sangat sesuai utk sesi PdP."]),
        _item(27, "Mempamerkan sikap positif (contoh: komited, berdedikasi, bermotivasi dan bersemangat) "
                  "terhadap pengajaran dan pembelajaran.",
              "Exhibit positive attitude (example: committed, dedicated and enthusiastic) towards teaching "
              "and learning.",
              [f"Tidak bersikap positif {_ATT}.", f"Kurang bersikap positif {_ATT}.",
               f"Bersikap positif {_ATT} tetapi pada tahap sederhana.",
               f"Bersikap positif {_ATT}.", f"Sangat bersikap positif {_ATT}."]),
        _item(28, "Menjaga tingkah laku dan perwatakan seorang pensyarah (penggunaan bahasa yang tidak kasar "
                  "dan sabar).",
              "Observe good behavior and professionalism demeanour (use of non-abusive language and patience).",
              ["Tidak menjaga tingkah laku dan perwatakan seorang pensyarah.",
               "Kurang menjaga tingkah laku dan perwatakan seorang pensyarah.",
               "Dapat menjaga tingkah laku dan perwatakan seorang pensyarah tetapi masih boleh diperbaiki.",
               "Dapat menjaga dengan sangat baik tingkah laku dan perwatakan seorang pensyarah.",
               "Menjaga dengan sempurna tingkah laku dan perwatakan seorang pensyarah."]),
        _item(29, "Memelihara persekitaran pembelajaran yang kondusif.", "Maintain a conducive learning environment.",
              ["Tidak menghormati pelajar.", "Kurang menghormati pelajar.",
               "Menghormati pelajar tetapi masih boleh diperbaiki.",
               "Dapat menghormati pelajar dengan sangat baik.",
               "Dapat menghormati pelajar dengan cemerlangnya."]),
    ]},
]
for _s in SECTIONS:
    _s["max"] = 5 * len(_s["items"])          # A=25, B1=35, B2=25, B3=30, C=30
ITEM_NUMBERS = [i["no"] for s in SECTIONS for i in s["items"]]
assert len(ITEM_NUMBERS) == 29 and sum(s["max"] for s in SECTIONS) == MAX_RAW

# ---- Prasarana & Fasiliti Pembelajaran di bilik kuliah (separate checklist, not part of the mark)
FACILITY_SCALE = ["Tidak berkenaan", "Sangat Lemah", "Lemah", "Memuaskan", "Baik", "Cemerlang"]  # 0..5
_R = "bilik kuliah/dewan kuliah/makmal/studio/bengkel"
FACILITY_ITEMS = [
    f"{_R.capitalize()} kondusif untuk pengajaran dan pembelajaran (PdP).",
    f"Saiz kelas bersesuaian dengan keluasan {_R}.",
    f"{_R.capitalize()} kemas dan tersusun.",
    f"Kelengkapan ICT di {_R} dalam keadaan baik.",
    f"Kelengkapan di {_R} seperti kerusi, meja, komputer mencukupi.",
    f"Kelengkapan di {_R} seperti kerusi, meja, papan putih dalam keadaan baik (tidak rosak).",
    f"Pengudaraan di {_R} sesuai untuk PdP.",
    f"Pencahayaan di {_R} sesuai untuk PdP.",
    f"{_R.capitalize()} dalam keadaan bersih.",
    f"Keselamatan di {_R} adalah terkawal.",
    f"Pendingin hawa (air-conditioner)/kipas di {_R} berfungsi dengan baik.",
    "Suis/port/plug untuk projektor berfungsi.",
    f"Internet mudah diakses di dalam {_R}.",
    f"Wifi mudah diakses di dalam {_R}.",
]


def compute(scores):
    """scores: {item_no: 1..5} (may be partial). Returns totals and final marks."""
    sec = {s["key"]: sum(scores.get(i["no"], 0) for i in s["items"]) for s in SECTIONS}
    raw = sum(sec.values())
    ts = round(raw * 50 / MAX_RAW, 2)
    tas = round(raw * 100 / MAX_RAW, 2)
    return {"sections": sec, "raw": raw, "ts": ts, "tas": tas,
            "complete": all(n in scores for n in ITEM_NUMBERS)}


def indicator(tas):
    if tas is None:
        return ""
    return next(label for floor, label in INDICATORS if tas >= floor)
