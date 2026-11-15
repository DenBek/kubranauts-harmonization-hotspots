"""POST-HOC comparison (not prespecified): day/night-split month factor (M1-DN) vs M1, same fit/test years.
Added because the project brief proposes country x month x day/night factors."""
import numpy as np, pandas as pd
from common import connect_local
from pairs import pair
con = connect_local()
def load(dn):
    d = pair(con, "Aqua", "Suomi NPP", dn, zone="ALL", y0=2012, y1=2025)
    return d.assign(yr=d.t.dt.year, mo=d.t.dt.month)[["t", "yr", "mo", "n_a", "n_b"]]
A, D, N = load("A"), load("D"), load("N")
fit = lambda d: d[d.yr.between(2012, 2019)].groupby("mo")[["n_b", "n_a"]].sum().pipe(lambda g: g.n_b / g.n_a)
pA = A.n_a * A.mo.map(fit(A))
m = D.merge(N, on=["t", "yr", "mo"], suffixes=("_d", "_n"), how="outer").fillna(0).merge(A[["t", "n_b"]], on="t")
kd, kn = fit(D), fit(N)
pDN = m.n_a_d * m.mo.map(kd) + m.n_a_n * m.mo.map(kn)
for lab, yrs in [("E1 2020-22", (2020, 2022)), ("E2 2023-25", (2023, 2025))]:
    for name, p, v, yr in [("M1", pA, A.n_b, A.yr), ("M1-DN", pDN, m.n_b, m.yr)]:
        s = yr.between(*yrs); le = np.log(p[s] / v[s])
        print(f"{lab} {name:6s} bias {100*(np.exp(le.mean())-1):6.1f}%  rmse_log {np.sqrt((le**2).mean()):.3f}  mdape {100*np.median(np.abs(p[s]/v[s]-1)):.1f}%")
print("night factor by month:", kn.round(1).to_dict())
