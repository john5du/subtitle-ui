package textsort

import "testing"

func TestSortKeyPinyin(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"阿凡达", "afanda"},
		{"霸王别姬", "bawangbieji"},
		{"Batman", "batman"},
		{"  Hello  ", "hello"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := SortKey(tc.in); got != tc.want {
			t.Fatalf("SortKey(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestLessChinesePinyinOrder(t *testing.T) {
	// 阿(a) < 霸(ba) < 长(chang) roughly; Batman (b) between 阿 and 长 depending on key.
	titles := []string{"长津湖", "阿凡达", "霸王别姬", "Batman"}
	// Expected by pinyin key: afanda, batman, bawangbieji, changjinhu
	order := []string{"阿凡达", "Batman", "霸王别姬", "长津湖"}

	for i := 0; i < len(order)-1; i++ {
		if !Less(order[i], order[i+1]) {
			t.Fatalf("expected %q < %q (keys %q / %q)", order[i], order[i+1], SortKey(order[i]), SortKey(order[i+1]))
		}
	}
	_ = titles
}
