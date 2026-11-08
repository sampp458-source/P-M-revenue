"""Extends official socket-only historical schema QA. No remote DSN accepted."""
from pathlib import Path
original=Path(__file__).with_name('daycare_recovery_v1_qa.py')
outer=original.read_text()
marker="exec(compile(source, str(Path(__file__)), 'exec'))"
assert outer.count(marker)==1
addition='''source=source.replace("a = p.parse_args()", "p.add_argument('--production-contract', type=Path, required=True)\\na = p.parse_args()")
source=source.replace("    report['passed']=len(checks)","    exec((ROOT/'supabase/tests/daycare_retrospective_completion_v1_cases.py').read_text())\\n    report['passed']=len(checks)")
exec(compile(source,str(Path(__file__)),'exec'))'''
exec(compile(outer.replace(marker,addition),str(original),'exec'),{'__file__':str(original),'__name__':'__main__'})
