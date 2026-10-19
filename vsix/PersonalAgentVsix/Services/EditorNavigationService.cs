using System;
using System.IO;
using System.Windows;
using EnvDTE;
using Microsoft.VisualStudio.Shell;

namespace PersonalAgentVsix.Services
{
    /// <summary>打开文件并跳转到指定行（DTE 实现）。</summary>
    public class EditorNavigationService
    {
        public void OpenAndGoto(string solutionPath, string relativeFile, int? line)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            if (string.IsNullOrEmpty(relativeFile)) return;

            string solutionDir = Path.GetDirectoryName(solutionPath);
            if (string.IsNullOrEmpty(solutionDir)) return;

            string fullPath = Path.GetFullPath(
                Path.Combine(solutionDir, relativeFile.Replace('/', Path.DirectorySeparatorChar)));

            if (!File.Exists(fullPath))
            {
                MessageBox.Show("文件不存在：" + fullPath);
                return;
            }

            var dte = ServiceProvider.GlobalProvider.GetService(typeof(DTE)) as DTE;
            if (dte == null) return;

            dte.ItemOperations.OpenFile(fullPath);
            if (line.HasValue && line.Value > 0 && dte.ActiveDocument != null)
            {
                var selection = dte.ActiveDocument.Selection as TextSelection;
                selection?.GotoLine(line.Value, true);
            }
        }
    }
}
