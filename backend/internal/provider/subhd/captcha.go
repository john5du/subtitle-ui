package subhd

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// lengthMap maps svg path d-attribute length to candidate characters.
// Ported from https://github.com/haua/svg-captcha-recognize
var lengthMap = map[int][]string{
	986:  {"I", "l"},
	998:  {"1"},
	1068: {"I", "l"},
	1081: {"1"},
	1082: {"v"},
	1130: {"Y"},
	1134: {"Y"},
	1172: {"v"},
	1224: {"Y"},
	1274: {"L", "y"},
	1298: {"V"},
	1311: {"V"},
	1360: {"i"},
	1380: {"L", "y"},
	1406: {"V"},
	1473: {"i"},
	1478: {"T"},
	1491: {"r"},
	1598: {"N", "X"},
	1601: {"T"},
	1604: {"X"},
	1610: {"J", "x"},
	1613: {"x"},
	1614: {"N"},
	1615: {"r", "N"},
	1616: {"N"},
	1617: {"N"},
	1618: {"N"},
	1634: {"k"},
	1637: {"k"},
	1694: {"z", "t"},
	1706: {"K"},
	1709: {"K"},
	1731: {"X", "N"},
	1744: {"x", "J"},
	1754: {"F"},
	1770: {"k"},
	1835: {"z", "t"},
	1838: {"u"},
	1840: {"A"},
	1844: {"A"},
	1848: {"K"},
	1850: {"Z"},
	1853: {"Z"},
	1886: {"h"},
	1900: {"F"},
	1922: {"H"},
	1928: {"H"},
	1960: {"P"},
	1991: {"u"},
	1993: {"A"},
	1996: {"D"},
	2004: {"Z"},
	2018: {"w"},
	2035: {"w"},
	2042: {"7"},
	2043: {"h"},
	2080: {"j"},
	2082: {"H"},
	2104: {"R"},
	2107: {"R"},
	2123: {"P"},
	2140: {"4"},
	2162: {"D"},
	2164: {"O"},
	2183: {"w"},
	2198: {"n", "C"},
	2199: {"C"},
	2200: {"C"},
	2201: {"C"},
	2202: {"C"},
	2210: {"f"},
	2212: {"7"},
	2246: {"E"},
	2253: {"j"},
	2260: {"o"},
	2272: {"d"},
	2279: {"R", "M"},
	2282: {"M"},
	2294: {"U"},
	2301: {"U"},
	2310: {"W"},
	2318: {"4", "W"},
	2321: {"M"},
	2332: {"a"},
	2344: {"O"},
	2345: {"W"},
	2346: {"W"},
	2366: {"s"},
	2380: {"b"},
	2381: {"n", "C"},
	2382: {"0"},
	2394: {"f"},
	2433: {"E"},
	2448: {"o"},
	2461: {"d"},
	2464: {"p"},
	2466: {"M"},
	2485: {"U"},
	2498: {"c"},
	2501: {"e"},
	2503: {"W"},
	2512: {"q"},
	2526: {"a"},
	2546: {"2"},
	2563: {"s"},
	2578: {"b"},
	2580: {"0"},
	2606: {"5"},
	2632: {"6"},
	2669: {"p"},
	2706: {"c"},
	2709: {"e"},
	2721: {"q"},
	2758: {"2"},
	2800: {"9"},
	2823: {"5"},
	2851: {"6"},
	3033: {"9"},
	3038: {"S"},
	3054: {"B"},
	3160: {"g"},
	3244: {"Q"},
	3254: {"Q"},
	3266: {"G"},
	3291: {"S"},
	3308: {"B"},
	3414: {"8"},
	3423: {"g"},
	3514: {"Q"},
	3538: {"G"},
	3663: {"m"},
	3667: {"m"},
	3698: {"8"},
	3878: {"3"},
	3968: {"m"},
	4201: {"3"},
}

var (
	rePathTag   = regexp.MustCompile(`(?i)<path[^>]*>`)
	rePathD     = regexp.MustCompile(`(?i)\bd="([^"]+)"`)
	reFirstNum  = regexp.MustCompile(`\d+(?:\.\d*)?`)
	reMove      = regexp.MustCompile(`(?i)M(\d+(?:\.\d*)?)\s+(\d+(?:\.\d*)?)`)
	reAllNums   = regexp.MustCompile(`\d+(?:\.\d*)?`)
)

// SolveSVG recognizes svg-captcha default-font challenges.
func SolveSVG(svg string) string {
	return solveSVGDetailed(svg).Code
}

// captchaSolveDiag is diagnostic detail from SVG captcha recognition.
type captchaSolveDiag struct {
	Code        string
	PathCount   int
	PathLens    []int
	UnknownLens []int
	EmptyChars  int // recognized empty for a path (unknown length or empty mapping)
}

func solveSVGDetailed(svg string) captchaSolveDiag {
	letters := extractLetterPaths(svg)
	if len(letters) == 0 {
		return captchaSolveDiag{}
	}
	diag := captchaSolveDiag{
		PathCount: len(letters),
		PathLens:  make([]int, 0, len(letters)),
	}
	var b strings.Builder
	for _, d := range letters {
		n := len(d)
		diag.PathLens = append(diag.PathLens, n)
		ch := recognizePath(d)
		if ch == "" {
			diag.EmptyChars++
			if len(lengthMap[n]) == 0 {
				diag.UnknownLens = append(diag.UnknownLens, n)
			}
		}
		b.WriteString(ch)
	}
	diag.Code = b.String()
	return diag
}

func extractLetterPaths(svg string) []string {
	type item struct {
		x float64
		d string
	}
	var items []item
	for _, tag := range rePathTag.FindAllString(svg, -1) {
		if len(tag) <= 500 {
			continue
		}
		m := rePathD.FindStringSubmatch(tag)
		if len(m) < 2 || m[1] == "" {
			continue
		}
		d := m[1]
		x := 0.0
		if nm := reFirstNum.FindString(d); nm != "" {
			x, _ = strconv.ParseFloat(nm, 64)
		}
		items = append(items, item{x: x, d: d})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].x < items[j].x })
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, it.d)
	}
	return out
}

func recognizePath(d string) string {
	n := len(d)
	if ch := resolveCollision(n, d); ch != "" {
		return ch
	}
	opts := lengthMap[n]
	if len(opts) == 0 {
		return ""
	}
	return opts[0]
}

func resolveCollision(length int, path string) string {
	minY := pathMinY(path)
	moveY := pathMoveY(path)
	wh0 := pathWidth(path)
	switch length {
	case 986, 1068:
		if minY > 13 {
			return "I"
		}
		return "l"
	case 1274, 1380:
		if moveY > 30 {
			return "y"
		}
		return "L"
	case 1610, 1744:
		if minY > 19 {
			return "x"
		}
		return "J"
	case 1615:
		if minY > 18 {
			return "r"
		}
		return "N"
	case 2198, 2381:
		if minY > 19 {
			return "n"
		}
		return "C"
	case 2318:
		if wh0 > 30 {
			return "W"
		}
		return "4"
	case 1598, 1731:
		if minY > 13 {
			return "X"
		}
		return "N"
	case 1694, 1835:
		if minY > 22 {
			return "z"
		}
		return "t"
	case 2279:
		if minY > 13 {
			return "R"
		}
		return "M"
	default:
		return ""
	}
}

func pathMoveY(path string) float64 {
	m := reMove.FindStringSubmatch(path)
	if len(m) < 3 {
		return 0
	}
	v, _ := strconv.ParseFloat(m[2], 64)
	return v
}

func pathAllXY(path string) (xs, ys []float64) {
	nums := reAllNums.FindAllString(path, -1)
	for i, raw := range nums {
		v, _ := strconv.ParseFloat(raw, 64)
		if i%2 == 0 {
			xs = append(xs, v)
		} else {
			ys = append(ys, v)
		}
	}
	return xs, ys
}

func pathMinY(path string) float64 {
	_, ys := pathAllXY(path)
	if len(ys) == 0 {
		return 0
	}
	min := ys[0]
	for _, y := range ys[1:] {
		if y < min {
			min = y
		}
	}
	return min
}

func pathWidth(path string) float64 {
	xs, _ := pathAllXY(path)
	if len(xs) == 0 {
		return 0
	}
	min, max := xs[0], xs[0]
	for _, x := range xs[1:] {
		if x < min {
			min = x
		}
		if x > max {
			max = x
		}
	}
	return max - min
}
