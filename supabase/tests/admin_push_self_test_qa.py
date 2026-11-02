"""Runs the complete notification DB suite, then self-test contracts in its isolated socket DB.
No remote connection or provider access. Uses captured Production predecessor definitions.
"""
from pathlib import Path
source=Path(__file__).with_name("notification_preview_other_qa.py").read_text()
cases=Path(__file__).with_name("admin_push_self_test_cases.py").read_text()
anchor=" OUT.joinpath('db-result.json').write_text"
assert source.count(anchor)==1
source=source.replace(anchor,"\n"+"\n".join(" "+line if line else "" for line in cases.splitlines())+"\n"+anchor)
exec(compile(source,str(Path(__file__).with_name("notification_preview_other_qa.py")),"exec"))
