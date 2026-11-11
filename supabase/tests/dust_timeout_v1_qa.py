"""Extend the preserved socket-only 260-case correction harness. Never accepts a remote DSN.
--compat-root points to the immutable prior rehearsal checkout; other arguments are its
captured schema, synthetic seed and predecessor contract. No Production credentials.
"""
from pathlib import Path
import sys
ix=sys.argv.index('--compat-root');compat=Path(sys.argv[ix+1]).resolve();del sys.argv[ix:ix+2]
HOT=Path(__file__).resolve().parents[2]
original=compat/'supabase/tests/daycare_recovery_v1_qa.py'
outer=original.read_text()
case_source=(compat/'supabase/tests/dust_transfer_correction_compat_v1_cases.py').read_text()
case_source=case_source.replace('# Explicit successful rehearsal ROLLBACK before committing synthetic case.',"exec((HOT/'supabase/tests/dust_timeout_v1_cases.py').read_text())\n# Explicit successful rehearsal ROLLBACK before committing synthetic case.")
assert case_source.count('rid=str(uuid.uuid4())') == 1
case_source=case_source.replace('rid=str(uuid.uuid4())', 'rid=retry_id # Commit the original timed-out request, not a fresh request.')
case_source += "\ncheck('completed request cannot retry',state(rid)['state']=='succeeded')\ncheck('another request also sees completed target',state(str(uuid.uuid4()))['state']=='succeeded')\n"
marker="exec(compile(source, str(Path(__file__)), 'exec'))"
addition='source=source.replace(\'a = p.parse_args()\',"p.add_argument(\'--production-contract\', type=Path, required=True)\\na = p.parse_args()")\nsource=source.replace("    report[\'passed\']=len(checks)","    exec((ROOT/\'supabase/tests/daycare_retrospective_completion_v1_cases.py\').read_text())\\n    exec(case_source)\\n    report[\'passed\']=len(checks)")\nexec(compile(source,str(Path(__file__)),\'exec\'))'
assert outer.count(marker)==1
exec(compile(outer.replace(marker,addition),str(original),'exec'),{'__file__':str(original),'__name__':'__main__','HOT':HOT,'case_source':case_source})
