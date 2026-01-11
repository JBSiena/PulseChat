import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export interface AuthUser {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
}

interface AuthState {
  token: string | null
  user: AuthUser | null
}

const initialState: AuthState = {
  token: null,
  user: null,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action: PayloadAction<{ token: string; user: AuthUser }>) {
      state.token = action.payload.token
      state.user = action.payload.user
    },
    clearAuth(state) {
      state.token = null
      state.user = null
    },
  },
})

export const { setCredentials, clearAuth } = authSlice.actions
export default authSlice.reducer
