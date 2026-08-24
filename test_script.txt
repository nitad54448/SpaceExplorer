standard workflow after changes in the script

python scripts\sitecheck.py scripts\cctbx_SpaceExplorer_v7.py
python scripts\audit_sg.py --selftest --gen scripts\cctbx_SpaceExplorer_v7.py
python scripts\cctbx_SpaceExplorer_v7.py
python scripts\audit_sg.py --gen scripts\cctbx_SpaceExplorer_v7.py --box 8