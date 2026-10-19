using System;
using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;

namespace PersonalAgentVsix.Converters
{
    /// <summary>severity → 颜色（与 Web 主题一致：error 红 / warning 橙 / suggestion 蓝）。</summary>
    public class SeverityToBrushConverter : IValueConverter
    {
        private static readonly Brush ErrorBrush = Create("#ef4444");
        private static readonly Brush WarningBrush = Create("#f59e0b");
        private static readonly Brush SuggestionBrush = Create("#0ea5e9");
        private static readonly Brush DefaultBrush = Create("#94a3b8");

        private static Brush Create(string hex)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            brush.Freeze();
            return brush;
        }

        public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        {
            switch (value as string)
            {
                case "error": return ErrorBrush;
                case "warning": return WarningBrush;
                case "suggestion": return SuggestionBrush;
                default: return DefaultBrush;
            }
        }

        public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        {
            throw new NotSupportedException();
        }
    }
}
