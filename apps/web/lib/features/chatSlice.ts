import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

interface ChatState {
  username: string
  room: string
}

const initialState: ChatState = {
  username: '',
  room: 'general',
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    setUsername(state, action: PayloadAction<string>) {
      state.username = action.payload
    },
    setRoom(state, action: PayloadAction<string>) {
      state.room = action.payload
    },
  },
})

export const { setUsername, setRoom } = chatSlice.actions
export default chatSlice.reducer
