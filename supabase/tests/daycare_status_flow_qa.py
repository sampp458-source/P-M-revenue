"""Normal Daycare flow on the established socket-only DB. Never accepts a remote DSN."""
from pathlib import Path
original=Path(__file__).with_name('daycare_recovery_v1_qa.py')
outer=original.read_text();marker="exec(compile(source, str(Path(__file__)), 'exec'))"
assert outer.count(marker)==1
addition='''source=source.replace("    report['passed']=len(checks)","    exec((ROOT/'supabase/tests/daycare_status_flow_cases.py').read_text())\\n    report['passed']=len(checks)")
exec(compile(source,str(Path(__file__)),'exec'))'''
exec(compile(outer.replace(marker,addition),str(original),'exec'),{'__file__':str(original),'__name__':'__main__'})
