using System.Runtime.InteropServices;
using Microsoft.VisualStudio.Shell;

namespace PersonalAgentVsix
{
    /// <summary>
    /// 「个人信息管家」工具窗口，承载 WPF 分析展示控件。
    /// </summary>
    [Guid("2B3C4D5E-6F7A-4B8C-9D0E-1F2A3B4C5D6E")]
    public class AnalysisToolWindow : ToolWindowPane
    {
        public AnalysisToolWindow() : base(null)
        {
            Caption = "个人信息管家";
            Content = new AnalysisToolWindowControl();
        }
    }
}
