"""Generated books and bookmarks; accepts only the newly created libraryqa profile."""
from pathlib import Path
import hashlib, json, sqlite3, struct, sys, uuid, zipfile, zlib
root=Path(sys.argv[1]).resolve()
assert root.name=='com.genzo.android.libraryqa'
assert json.loads((root/'owned-fixture.json').read_text(encoding='utf8'))['createdForThisTest'] is True
db=sqlite3.connect(root/'genzo.db')
assert db.execute('SELECT COUNT(*) FROM works').fetchone()[0]==0
assert db.execute('SELECT COUNT(*) FROM android_reading_bookmarks').fetchone()[0]==0
now='2026-10-18T01:00:00Z'
def png(index):
    def chunk(tag,data):return struct.pack('!I',len(data))+tag+data+struct.pack('!I',zlib.crc32(tag+data)&0xffffffff)
    row=b'\0'+bytes([70+index*20,130+index*10,190])*480
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',480,800,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(row*800))+chunk(b'IEND',b'')
marks={}
for kind in ['comic','novel']:
    book=f'reader-fixture-{kind}';title='合成漫画书签验收' if kind=='comic' else '合成小说书签验收';group='default' if kind=='comic' else ''
    folder=root/('reading-cache' if kind=='comic' else 'external-reading-cache')/'v1'/hashlib.sha256(f'{kind}\n{book}\none'.encode()).hexdigest()/'complete-001-fixture'
    folder.mkdir(parents=True)
    filename='chapter.cbz' if kind=='comic' else 'volume.epub'
    with zipfile.ZipFile(folder/filename,'w') as archive:
        if kind=='comic':
            for i in range(6):archive.writestr(f'{i+1:04}.png',png(i))
        else:
            archive.writestr('mimetype','application/epub+zip')
            archive.writestr('META-INF/container.xml','<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
            manifest=''.join(f'<item id="c{i}" href="chapter-{i}.xhtml" media-type="application/xhtml+xml"/>' for i in range(2))
            spine=''.join(f'<itemref idref="c{i}"/>' for i in range(2))
            archive.writestr('OEBPS/content.opf',f'<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">qa-generated-novel</dc:identifier><dc:title>合成小说书签验收</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-10-18T00:00:00Z</meta></metadata><manifest>{manifest}</manifest><spine>{spine}</spine></package>')
            for i in range(2):
                body=''.join(f'<p id="p{n}">第{i+1}章合成验收正文第{n+1}段。这些段落专用于阅读位置与书签测试。</p>' for n in range(180))
                archive.writestr(f'OEBPS/chapter-{i}.xhtml',f'<html xmlns="http://www.w3.org/1999/xhtml" lang="zh"><head><title>第{i+1}章</title></head><body>{body}</body></html>')
    data=(folder/filename).read_bytes()
    (folder/'manifest.json').write_text(json.dumps(dict(version=1,kind=kind,bookId=book,entryId='one',title=title,openFile=filename,files=[dict(name=filename,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))],cachedAt=now),ensure_ascii=False),encoding='utf8')
    db.execute("INSERT INTO works(id,title,type,notes,created_at,updated_at) VALUES(?,?,?,'合成验收笔记',?,?)",(book,title,kind,now,now))
    db.execute('INSERT INTO work_external_ids(work_id,provider,external_id,created_at,updated_at) VALUES(?,?,?,?,?)',(book,'copymanga' if kind=='comic' else 'copynovel',book,now,now))
    old={'pageIndex':0,'offset':0.0} if kind=='comic' else {'href':'OEBPS/chapter-0.xhtml','type':'application/xhtml+xml','locations':{'progression':0.0}}
    saved={'pageIndex':2,'offset':0.0} if kind=='comic' else {'href':'OEBPS/chapter-1.xhtml','type':'application/xhtml+xml','locations':{'progression':0.0}}
    db.execute('INSERT INTO android_reading_progress VALUES(?,?,?,?,?,?)',(kind,book,group,'one',json.dumps(old),now))
    db.execute('INSERT INTO android_reading_history VALUES(?,?,?,?,?,?,0)',(kind,book,group,'one',title,6 if kind=='comic' else None))
    mark=str(uuid.uuid4());marks[kind]=mark
    db.execute('INSERT INTO android_reading_bookmarks VALUES(?,?,?,?,?,?,?,?)',(mark,kind,book,group,'one',json.dumps(saved),'第三页书签' if kind=='comic' else '第二章书签',now))
    params=[['limit','100'],['offset','0']] if kind=='comic' else []
    path=f'/api/v3/comic/{book}/group/default/chapters' if kind=='comic' else f'/api/v3/book/{book}/volumes'
    page=dict(entries=[dict(id='one',title=title,order=0,count=6)],total=1,offset=0,group=group,groups=[dict(id='default',title='默认')] if kind=='comic' else [],stale=False)
    db.execute("INSERT INTO metadata_cache VALUES('copy-reading',?,?,?,?)",('v1:https://example.invalid'+path+':'+json.dumps(params,separators=(',',':')),json.dumps(page,ensure_ascii=False),now,'2099-01-01T00:00:00Z'))
db.commit();db.close()
(root/'bookmark-ids.json').write_text(json.dumps(marks),encoding='utf8')
print('Created two synthetic archives and two bookmarks in the owned QA profile')
