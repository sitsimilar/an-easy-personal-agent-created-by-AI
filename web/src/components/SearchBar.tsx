import { useState } from 'react'
import { Box, IconButton, InputAdornment, TextField } from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'

interface SearchBarProps {
  onSearch?: (keyword: string) => void
  placeholder?: string
}

/** 关键词检索输入框。 */
export default function SearchBar({ onSearch, placeholder }: SearchBarProps) {
  const [value, setValue] = useState('')

  const submit = () => {
    const kw = value.trim()
    if (!kw) return
    onSearch?.(kw)
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
      <TextField
        size="small"
        fullWidth
        variant="outlined"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
        }}
        placeholder={placeholder ?? '输入关键词检索想法、资料、待办'}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton onClick={submit} edge="end" size="small">
                <SearchIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  )
}
