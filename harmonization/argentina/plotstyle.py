import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
COL = {"Terra": "#2a78d6", "Aqua": "#eb6834", "Suomi NPP": "#1baf7a", "NOAA-20": "#eda100",
       "stitched": "#333333", "other": "#8a8a8a"}
plt.rcParams.update({"figure.dpi": 110, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.grid": True, "grid.color": "#e6e6e6", "grid.linewidth": 0.6,
                     "lines.linewidth": 1.6, "font.size": 9, "legend.frameon": False})
